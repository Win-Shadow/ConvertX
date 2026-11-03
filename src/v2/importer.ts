import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { mkdirSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";

import sanitize from "sanitize-filename";

import { probe } from "./probe";
import { extOf, kindOf } from "./recipes";
import { uploadsDirFor } from "./runner";
import { db } from "./store";

const MAX_REDIRECTS = 5;

// The server sits on the home LAN, so a fetched URL must never reach private address space.
const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) blocked.addSubnet(net, bits, "ipv6");

function v6Bytes(ip: string): number[] | null {
  let v = ip.toLowerCase().split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) {
    const o = dotted[1]!.split(".").map(Number);
    v = v.slice(0, -dotted[1]!.length) + `${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const [head, tail] = v.includes("::") ? v.split("::") as [string, string] : [v, null];
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = tail === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => { const n = parseInt(g || "0", 16); return [n >> 8, n & 255]; });
}

// IPv6 forms that carry an IPv4 address inside them: mapped, compatible, NAT64, 6to4.
function embeddedV4(b: number[]): string | null {
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
  if (zero(0, 10) && b[10] === 255 && b[11] === 255) return b.slice(12).join(".");
  if (zero(0, 12)) return b.slice(12).join(".");
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zero(4, 12)) return b.slice(12).join(".");
  if (b[0] === 0x20 && b[1] === 0x02) return b.slice(2, 6).join(".");
  return null;
}

export function privateAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return blocked.check(ip, "ipv4");
  if (fam !== 6) return true;
  const b = v6Bytes(ip);
  if (!b) return true;
  const v4 = embeddedV4(b);
  if (v4 && blocked.check(v4, "ipv4")) return true;
  const canon = Array.from({ length: 8 }, (_, i) => ((b[2 * i]! << 8) | b[2 * i + 1]!).toString(16)).join(":");
  return blocked.check(canon, "ipv6");
}

function assertAllowed(u: URL): void {
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Only http and https links work.");
  if (u.username || u.password) throw new Error("Links with passwords in them aren't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && privateAddress(host)) throw new Error("That link points inside a private network.");
}

// Resolution happens inside the connection itself, so the address that was checked is the one connected to.
const guardedLookup: LookupFunction = (host, opts, cb) => {
  dnsLookup(host, { ...opts, all: true }, (err, addrs) => {
    if (err || !addrs.length) return cb(err ?? new Error("That website couldn't be found."), []);
    if (addrs.some((a) => privateAddress(a.address))) return cb(new Error("That link points inside a private network."), []);
    if (opts.all) return (cb as unknown as (e: null, a: LookupAddress[]) => void)(null, addrs);
    cb(null, addrs[0]!.address, addrs[0]!.family);
  });
};

const IDLE_TIMEOUT_MS = 30_000;

function get(u: URL): Promise<Response> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(u, { method: "GET", lookup: guardedLookup, headers: { "user-agent": "Mozilla/5.0 (ConvertX import)" } }, (res) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
      const status = res.statusCode ?? 502;
      const body = status >= 200 && status !== 204 && status !== 304 ? (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>) : (res.resume(), null);
      resolve(new Response(body, { status, headers }));
    });
    // Idle timeout, not a total one: a big file on a slow link keeps going as long as bytes keep arriving.
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error("The operation timed out.")));
    req.on("error", reject);
    req.end();
  });
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
    assertAllowed(u);
    res = await get(u);
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      void res.body?.cancel();
      u = new URL(res.headers.get("location")!, u);
      res = null;
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
