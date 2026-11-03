import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { Elysia } from "elysia";
import sanitize from "sanitize-filename";

import { BRANDING, WEBROOT } from "../helpers/env";
import { outputDirFor } from "./runner";
import { zipResponse } from "./zip";
import { db, type ShareRow } from "./store";

export const SHARE_CHOICES: Record<string, { hours: number; max: number | null }> = {
  "24h": { hours: 24, max: null },
  "3d": { hours: 72, max: null },
  "7d": { hours: 168, max: null },
  once: { hours: 168, max: 1 },
};

export function createShare(jobId: number, itemId: number | null, choice: string, keepUntil: string | null): ShareRow {
  const c = SHARE_CHOICES[choice] ?? SHARE_CHOICES["24h"]!;
  let expires = Date.now() + c.hours * 3600_000;
  // a link can't outlive the files it points at
  if (keepUntil && keepUntil !== "forever") expires = Math.min(expires, new Date(keepUntil).getTime());
  const row: ShareRow = {
    token: randomBytes(16).toString("base64url"),
    job_id: jobId,
    item_id: itemId,
    expires: new Date(expires).toISOString(),
    max_downloads: c.max,
    downloads: 0,
    created: new Date().toISOString(),
  };
  db.query("INSERT INTO v2_shares (token, job_id, item_id, expires, max_downloads, downloads, created) VALUES (?, ?, ?, ?, ?, 0, ?)").run(row.token, row.job_id, row.item_id, row.expires, row.max_downloads, row.created);
  return row;
}

export function sharesFor(jobId: number): ShareRow[] {
  return db.query("SELECT * FROM v2_shares WHERE job_id = ? ORDER BY created DESC").all(jobId) as ShareRow[];
}

function live(token: string): { share: ShareRow; job: { id: number; user_id: number } } | null {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const share = db.query("SELECT * FROM v2_shares WHERE token = ?").get(token) as ShareRow | null;
  if (!share) return null;
  if (new Date(share.expires).getTime() < Date.now()) return null;
  if (share.max_downloads != null && share.downloads >= share.max_downloads) return null;
  const job = db.query("SELECT id, user_id FROM jobs WHERE id = ?").get(share.job_id) as { id: number; user_id: number } | null;
  return job ? { share, job } : null;
}

function files(share: ShareRow, job: { id: number; user_id: number }) {
  const rows = (share.item_id != null
    ? db.query("SELECT id, out_name, out_size FROM v2_items WHERE id = ? AND job_id = ? AND status = 'done'").all(share.item_id, job.id)
    : db.query("SELECT id, out_name, out_size FROM v2_items WHERE job_id = ? AND status = 'done' ORDER BY id").all(job.id)) as { id: number; out_name: string; out_size: number }[];
  const dir = outputDirFor(job.user_id, job.id);
  return rows.filter((r) => existsSync(path.join(dir, sanitize(r.out_name))));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const size = (b: number) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(1) + " GB" : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><link rel="icon" type="image/svg+xml" href="${WEBROOT}/favicon.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;800&display=swap">
<style>
:root{--bg:hsl(215 18% 7%);--sf:hsl(215 18% 10%);--bd:hsl(215 18% 18%);--tx:hsl(215 20% 95%);--mu:hsl(215 12% 68%);--ac:#88c0d0;--on:#16232e}
@media (prefers-color-scheme: light){:root{--bg:hsl(215 18% 97%);--sf:#fff;--bd:hsl(215 18% 88%);--tx:hsl(215 25% 12%);--mu:hsl(215 10% 36%);--ac:#2e6787;--on:#fff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:Manrope,system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 16px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font-size:30px;letter-spacing:-.02em}.mu{color:var(--mu)}
.card{border:1px solid var(--bd);border-radius:18px;background:var(--sf);overflow:hidden}
.row{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--bd)}.row:last-child{border-bottom:0}
.row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
a.btn{display:block;text-align:center;padding:18px;border-radius:16px;background:var(--ac);color:var(--on);font-weight:800;font-size:18px;text-decoration:none}
a.sm{color:var(--ac);font-weight:700;text-decoration:none;white-space:nowrap}
</style></head><body><main>${body}</main></body></html>`;
}

const gone = () => new Response(page("Link expired", `<h1>This link has expired</h1><p class="mu">Ask the person who sent it for a new one.</p>`), { status: 410, headers: { "content-type": "text/html; charset=utf-8" } });

function countDownload(share: ShareRow) {
  db.query("UPDATE v2_shares SET downloads = downloads + 1 WHERE token = ?").run(share.token);
}

export const publicShares = new Elysia()
  .get("/s/:token", ({ params }) => {
    const l = live(params.token);
    if (!l) return gone();
    const list = files(l.share, l.job);
    if (!list.length) return gone();
    const base = `${WEBROOT}/s/${params.token}`;
    const until = new Date(l.share.expires).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const once = l.share.max_downloads === 1;
    const rows = list.map((f) => `<div class="row"><span>${esc(f.out_name)}</span><small class="mu">${size(f.out_size)}</small><a class="sm" href="${base}/f/${f.id}">Download</a></div>`).join("");
    const main = list.length > 1 ? `<a class="btn" href="${base}/zip">Download all (${list.length} files)</a>` : `<a class="btn" href="${base}/f/${list[0]!.id}">Download ${esc(list[0]!.out_name)}</a>`;
    const note = once ? "This link works for one download." : `This link works until ${until}.`;
    return new Response(page(`${list.length} file${list.length > 1 ? "s" : ""} for you`, `<h1>${list.length === 1 ? "A file" : `${list.length} files`} for you</h1><p class="mu">${note} Shared from ${esc(BRANDING === "ConvertX" ? "Convert" : BRANDING)}.</p>${main}${once && list.length > 1 ? "" : `<div class="card">${rows}</div>`}`), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  })
  .get("/s/:token/f/:itemId", ({ params, set }) => {
    const l = live(params.token);
    if (!l) return gone();
    const f = files(l.share, l.job).find((x) => x.id === Number(params.itemId));
    if (!f) return gone();
    countDownload(l.share);
    set.headers["content-disposition"] = `attachment; filename*=UTF-8''${encodeURIComponent(f.out_name)}`;
    return Bun.file(path.join(outputDirFor(l.job.user_id, l.job.id), sanitize(f.out_name)));
  })
  .get("/s/:token/zip", async ({ params }) => {
    const l = live(params.token);
    if (!l) return gone();
    const list = files(l.share, l.job);
    if (!list.length) return gone();
    const dir = path.resolve(outputDirFor(l.job.user_id, l.job.id));
    const res = await zipResponse(list.map((f) => path.join(dir, sanitize(f.out_name))), "files.zip");
    if (!res) return new Response("Couldn't build the zip", { status: 500 });
    countDownload(l.share);
    return res;
  });
