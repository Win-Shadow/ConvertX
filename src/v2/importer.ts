import { lookup } from "node:dns/promises";
import { mkdirSync, rmSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import sanitize from "sanitize-filename";

import { probe } from "./probe";
import { extOf, kindOf } from "./recipes";
import { uploadsDirFor } from "./runner";
import { db } from "./store";

const MAX_REDIRECTS = 5;

// The server sits on the home LAN, so a fetched URL must never reach private address space.
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? privateAddress(mapped[1]!) : false;
}

async function assertPublic(u: URL): Promise<void> {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https links work.");
  if (u.username || u.password) throw new Error("Links with passwords in them aren't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error("That website couldn't be found.");
  if (addrs.some((a) => privateAddress(a.address))) throw new Error("That link points inside a private network.");
}

// Share-page links → direct downloads for the services people actually paste.
export function directUrl(raw: string): URL {
  const u = new URL(raw.trim());
  const host = u.hostname.toLowerCase();
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = /\/d\/([\w-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (id) return new URL(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`);
  }
  if (host.endsWith("dropbox.com")) {
    u.searchParams.delete("dl");
    u.searchParams.set("dl", "1");
    return u;
  }
  return u;
}

const TYPE_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/webp": "webp", "image/gif": "gif",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a",
  "audio/wav": "wav", "application/pdf": "pdf", "application/zip": "zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
};

function nameFrom(res: Response, u: URL): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd)?.[1];
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1];
  let name = "";
  try {
    name = star ? decodeURIComponent(star.trim().replace(/^"|"$/g, "")) : plain?.trim() ?? "";
  } catch {
    name = plain?.trim() ?? "";
  }
  if (!name) name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
  name = sanitize(name).slice(0, 180) || "download";
  if (!extOf(name)) {
    const ext = TYPE_EXT[(res.headers.get("content-type") ?? "").split(";")[0]!.trim()];
    if (ext) name += `.${ext}`;
  }
  return name;
}

function uniqueIn(jobId: number, name: string): string {
  const taken = new Set((db.query("SELECT name FROM v2_uploads WHERE job_id = ?").all(jobId) as { name: string }[]).map((r) => r.name));
  if (!taken.has(name)) return name;
  const i = name.lastIndexOf("."), base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : "";
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})${ext}`)) return `${base} (${n})${ext}`;
}

// Returns once headers arrive (so the client gets a name to show); the body streams in the background.
export async function startImport(userId: string | number, jobId: number, raw: string, maxBytes: number): Promise<{ name: string; size: number }> {
  let u = directUrl(raw);
  let res: Response | null = null;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(u);
    res = await fetch(u, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (ConvertX import)" }, signal: AbortSignal.timeout(30_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    break;
  }
  if (!res || !res.ok || !res.body) throw new Error(res ? `The website answered with an error (${res.status}).` : "Too many redirects.");
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("text/html")) throw new Error("That link opens a web page, not a file. Use the file's download link.");
  const length = Number(res.headers.get("content-length") ?? -1);
  if (length > maxBytes) throw new Error(`That file is bigger than ${Math.round(maxBytes / 1048576)} MB.`);

  const name = uniqueIn(jobId, nameFrom(res, u));
  db.query("INSERT INTO v2_uploads (job_id, name, size, received, source) VALUES (?, ?, ?, 0, ?)").run(jobId, name, length > 0 ? length : -1, raw.slice(0, 500));
  const dir = uploadsDirFor(userId, jobId);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  void pump(res.body, file, jobId, name, maxBytes);
  return { name, size: length };
}

async function pump(body: ReadableStream<Uint8Array>, file: string, jobId: number, name: string, maxBytes: number) {
  const writer = Bun.file(file).writer();
  let received = 0, lastSave = 0;
  const set = db.query("UPDATE v2_uploads SET received = ? WHERE job_id = ? AND name = ?");
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > maxBytes) throw new Error(`That file is bigger than ${Math.round(maxBytes / 1048576)} MB.`);
      writer.write(value);
      if (received - lastSave > 1 << 20) {
        lastSave = received;
        await writer.flush();
        set.run(received, jobId, name);
      }
    }
    await writer.end();
    const info = await probe(file, kindOf(extOf(name)));
    db.query("UPDATE v2_uploads SET size = ?, received = ?, info = ? WHERE job_id = ? AND name = ?").run(received, received, JSON.stringify(info), jobId, name);
  } catch (e) {
    try {
      await writer.end();
    } catch {
      /* already closed */
    }
    rmSync(file, { force: true });
    db.query("UPDATE v2_uploads SET error = ? WHERE job_id = ? AND name = ?").run(e instanceof Error ? e.message : "Download failed.", jobId, name);
  }
}
