import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { mainConverter } from "../converters/main";
import { normalizeFiletype } from "../helpers/normalizeFiletype";
import { clipDuration, extOf, GENERIC_PREFIX, recipeById, resolveOpts, type FileInfo, type OptionValues } from "./recipes";
import { db, getItems, refreshJobStatus, updateItem, type ItemRow } from "./store";

export const DATA = "./data";
export const uploadsDirFor = (userId: string | number, jobId: number) => `${DATA}/uploads/${userId}/${jobId}/`;
export const outputDirFor = (userId: string | number, jobId: number) => `${DATA}/output/${userId}/${jobId}/`;
const tmpDirFor = (itemId: number) => `${DATA}/tmp/v2-${itemId}`;

const CONCURRENCY = Number(process.env.MAX_CONVERT_PROCESS) > 0 ? Number(process.env.MAX_CONVERT_PROCESS) : 2;

const queue: number[] = [];
let active = 0;

export function enqueue(itemId: number): void {
  queue.push(itemId);
  pump();
}

function pump(): void {
  while (active < CONCURRENCY && queue.length) {
    const id = queue.shift()!;
    active++;
    runItem(id)
      .catch((e) => console.error("[v2] item crashed", id, e))
      .finally(() => {
        active--;
        pump();
      });
  }
}

export function queueStats(): { running: number; waiting: number } {
  return { running: active, waiting: queue.length };
}

export function queuePosition(itemId: number): number {
  return queue.indexOf(itemId);
}

// On boot, anything left running/queued from a previous process gets requeued.
export function resumePending(): void {
  const rows = db.query("SELECT id FROM v2_items WHERE status IN ('queued','running') ORDER BY id").all() as { id: number }[];
  for (const r of rows) {
    updateItem(r.id, { status: "queued", progress: 0 });
    enqueue(r.id);
  }
}

function uniqueName(dir: string, name: string): string {
  if (!existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!existsSync(path.join(dir, n))) return n;
  }
}

function friendlyError(stderr: string, cmd: string): { error: string; fixable: boolean } {
  const s = stderr.toLowerCase();
  if (s.includes("no space left")) return { error: "The server ran out of space. Tell Jorge.", fixable: false };
  if (cmd === "ffmpeg" && /(invalid data found|corrupt|error while decoding|invalid nal|moov atom not found|truncat)/.test(s)) {
    return { error: "Part of this file looks damaged. We can skip the broken parts and save the rest.", fixable: true };
  }
  if (cmd === "ocrmypdf" && s.includes("page already has text")) return { error: "This PDF already has text. Use \"Plain text\" instead.", fixable: false };
  if (cmd === "ocrmypdf" && s.includes("digital signature")) return { error: "This PDF is digitally signed, so it can't be changed.", fixable: false };
  if (cmd === "whisper-cli" && /failed to (open|read)|no audio/.test(s)) return { error: "This file has no sound to transcribe.", fixable: false };
  if (s.includes("password") || s.includes("encrypted")) return { error: "This file is password-protected. Remove the password and try again.", fixable: false };
  if (/not found|enoent/.test(s) && s.includes("spawn")) return { error: `A converter tool (${cmd}) is missing on the server. Tell Jorge.`, fixable: false };
  return { error: "Something went wrong converting this file. Try a different format, or see the technical details.", fixable: false };
}

async function eachLine(stream: ReadableStream<Uint8Array>, fn: (line: string) => void, sink?: (chunk: Uint8Array) => void): Promise<void> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sink?.(value);
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.search(/[\r\n]/)) >= 0) {
      fn(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
    if (buf.length > 65536) buf = buf.slice(-4096);
  }
  if (buf) fn(buf);
}

interface ExecOpts {
  onStdout?: ((line: string) => void) | undefined;
  onStderr?: ((line: string) => void) | undefined;
  stdoutTo?: string | undefined;
}

async function exec(cmd: string, args: string[], o: ExecOpts = {}): Promise<{ code: number; stderr: string }> {
  let proc;
  try {
    proc = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: process.env.HOME ?? "/tmp" } });
  } catch (e) {
    return { code: 127, stderr: `spawn ${cmd} ENOENT ${String(e)}` };
  }
  const writer = o.stdoutTo ? Bun.file(o.stdoutTo).writer() : null;
  const readOut = eachLine(proc.stdout, o.onStdout ?? (() => {}), writer ? (c) => void writer.write(c) : undefined);
  let tail = "";
  const readErr = eachLine(proc.stderr, (line) => {
    o.onStderr?.(line);
    tail = (tail + line + "\n").slice(-6000);
  });
  await Promise.all([readOut, readErr]);
  if (writer) await writer.end();
  const code = await proc.exited;
  return { code, stderr: tail };
}

async function runItem(itemId: number): Promise<void> {
  const item = db.query("SELECT * FROM v2_items WHERE id = ?").get(itemId) as ItemRow | null;
  if (!item || item.status !== "queued") return;
  const job = db.query("SELECT * FROM jobs WHERE id = ?").get(item.job_id) as { id: number; user_id: number } | null;
  if (!job) return;

  updateItem(itemId, { status: "running", progress: 0, error: null, detail: null, fixable: 0 });
  db.query("UPDATE jobs SET status = 'running' WHERE id = ?").run(job.id);

  const inDir = uploadsDirFor(job.user_id, job.id);
  const outDir = outputDirFor(job.user_id, job.id);
  const tmp = tmpDirFor(itemId);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const inputs: string[] = JSON.parse(item.inputs);
  const absInputs = inputs.map((n) => path.resolve(inDir, n));
  const infos: FileInfo[] = inputs.map((n) => {
    const r = db.query("SELECT info FROM v2_uploads WHERE job_id = ? AND name = ?").get(job.id, n) as { info: string | null } | null;
    try {
      return r?.info ? JSON.parse(r.info) : {};
    } catch {
      return {};
    }
  });

  const finish = (fields: Partial<ItemRow>) => {
    updateItem(itemId, { ...fields, finished: new Date().toISOString() });
    rmSync(tmp, { recursive: true, force: true });
    refreshJobStatus(job.id);
  };

  // Generic: hand off to ConvertX's own converter registry.
  if (item.recipe.startsWith(GENERIC_PREFIX)) {
    const target = item.recipe.slice(GENERIC_PREFIX.length);
    const src = absInputs[0]!;
    const base = path.basename(inputs[0]!, path.extname(inputs[0]!));
    const tmpOut = path.join(path.resolve(tmp), `${base}.${target}`);
    const res = await mainConverter(src, normalizeFiletype(extOf(src)), target, tmpOut, {});
    const produced = findOutputs(tmp, target, tmpOut);
    if (res === "File type not supported" || !produced.length) {
      return finish({ status: "failed", error: res === "File type not supported" ? "This file can't be turned into that format." : "Something went wrong converting this file. Try a different format.", detail: String(res) });
    }
    return finish(placeOutputs(produced, outDir, item.out_name ?? `${base}.${target}`, itemId));
  }

  const recipe = recipeById(item.recipe);
  if (!recipe) return finish({ status: "failed", error: "Unknown conversion.", detail: item.recipe });

  const opts: OptionValues = resolveOpts(recipe, JSON.parse(item.opts || "{}"));
  const outName = item.out_name ?? `${path.basename(inputs[0]!, path.extname(inputs[0]!))}.${recipe.ext}`;
  const tmpOut = path.join(path.resolve(tmp), outName);
  const steps = recipe.plan({ inputs: absInputs, output: tmpOut, tmp: path.resolve(tmp), opts, info: infos, tolerant: item.tolerant === 1 });
  const dur = clipDuration({ opts, info: infos });

  let lastPct = -1;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const base = Math.floor((i / steps.length) * 100);
    const span = 100 / steps.length;
    const report = (frac: number) => {
      const pct = Math.max(0, Math.min(99, Math.floor(base + frac * span)));
      if (pct !== lastPct) {
        lastPct = pct;
        updateItem(itemId, { progress: pct });
      }
    };
    const kind = step.progress ?? (step.cmd === "ffmpeg" ? "ffmpeg" : undefined);
    const onStdout = kind === "ffmpeg" ? (line: string) => {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m) report(Number(m[1]) / 1e6 / dur);
    } : undefined;
    const onStderr = kind === "whisper" ? (line: string) => {
      const m = /progress =\s*(\d+)%/.exec(line);
      if (m) report(Number(m[1]) / 100);
    } : undefined;
    const { code, stderr } = await exec(step.cmd, step.args, { onStdout, onStderr, stdoutTo: step.stdoutTo });
    if (code !== 0) {
      const fe = friendlyError(stderr, step.cmd);
      return finish({ status: "failed", error: fe.error, fixable: fe.fixable && item.tolerant !== 1 ? 1 : 0, detail: `$ ${step.cmd} ${step.args.join(" ")}\n\n${stderr}` });
    }
    if (!kind) updateItem(itemId, { progress: Math.floor(base + span) });
  }

  const produced = findOutputs(tmp, recipe.ext, tmpOut);
  if (!produced.length) return finish({ status: "failed", error: "The converter finished but produced no file.", detail: steps.map((s) => `$ ${s.cmd} ${s.args.join(" ")}`).join("\n") });

  if (recipe.id === "pdf-txt" && statSync(produced[0]!).size < 20) {
    return finish({ status: "failed", error: "This PDF is a scanned picture, so there's no text inside to copy.", detail: "pdftotext produced an empty file" });
  }
  return finish(placeOutputs(produced, outDir, outName, itemId));
}

function findOutputs(tmp: string, ext: string, expected: string): string[] {
  if (existsSync(expected)) return [expected];
  // soffice and some converters name outputs themselves
  return readdirSync(tmp)
    .filter((f) => f.toLowerCase().endsWith(`.${ext}`))
    .map((f) => path.join(tmp, f));
}

function placeOutputs(produced: string[], outDir: string, wanted: string, itemId: number): Partial<ItemRow> {
  const name = uniqueName(outDir, wanted);
  renameSync(produced[0]!, path.join(outDir, name));
  const size = statSync(path.join(outDir, name)).size;
  void itemId;
  return { status: "done", progress: 100, out_name: name, out_size: size };
}

export function jobItemsSummary(jobId: number) {
  return getItems(jobId).map((i) => ({
    id: i.id,
    recipe: i.recipe,
    inputs: JSON.parse(i.inputs) as string[],
    outName: i.out_name,
    status: i.status,
    progress: i.progress,
    queuePos: i.status === "queued" ? queuePosition(i.id) : -1,
    error: i.error,
    fixable: i.fixable === 1,
    detail: i.detail,
    inSize: i.in_size,
    outSize: i.out_size,
  }));
}
