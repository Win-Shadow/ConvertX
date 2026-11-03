import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { Elysia, t } from "elysia";
import sanitize from "sanitize-filename";

import { getPossibleTargets } from "../converters/main";
import db from "../db/db";
import { ACCOUNT_REGISTRATION, ALLOW_UNAUTHENTICATED, HTTP_ALLOWED, UNAUTHENTICATED_USER_SHARING, WEBROOT } from "../helpers/env";
import { isAnonymousId, userService } from "../services/user";
import { probe } from "./probe";
import { extOf, GENERIC_PREFIX, kindOf, recipeById } from "./recipes";
import { enqueue, jobItemsSummary, outputDirFor, queueStats, resumePending, uploadsDirFor } from "./runner";
import { getAccount, getSettings, quotaBytes, usedBytes } from "./accounts";
import { startImport } from "./importer";
import { createShare, SHARE_CHOICES, sharesFor } from "./share";
import { zipResponse } from "./zip";
import { deleteV2Rows, getJob, getUploads, type JobRow, type UploadRow } from "./store";

const MAX_UPLOAD_BYTES = (Number(process.env.MAX_UPLOAD_MB) || 4096) * 1024 * 1024;
const KEEP_CHOICES = [24, 72, 168, -1]; // hours, -1 = until deleted

resumePending();

function accountBrief(id: string) {
  const a = getAccount(id);
  return a ? { name: a.name, role: a.role, expires: a.expires } : null;
}

// Converting can roughly double what a file takes up (original + result), so check against the upload size alone.
function quotaProblem(userId: string, incoming: number): string | null {
  const a = getAccount(userId);
  // No account row (anonymous sessions) still gets the server's default quota, never unlimited.
  const mb = getSettings().defaultQuotaMb;
  const q = a ? quotaBytes(a) : mb > 0 ? mb * 1024 * 1024 : 0;
  if (!q) return null;
  const used = usedBytes(userId);
  if (used + incoming <= q) return null;
  const h = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
  const need = incoming ? ` This file needs ${h(incoming)}.` : "";
  return `You're using ${h(used)} of your ${h(q)}.${need} Delete old conversions in History to make room.`;
}

function keepUntil(hours: number): string | null {
  if (hours === -1) return "forever";
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function jobView(job: JobRow) {
  return {
    id: job.id,
    created: job.date_created,
    status: job.status,
    keepUntil: job.keep_until,
    uploads: getUploads(job.id).map((u) => {
      const r = u as UploadRow & { error?: string | null; source?: string | null };
      return { name: u.name, size: u.size, received: u.received, complete: u.size >= 0 && u.received >= u.size && !!u.info, info: u.info ? JSON.parse(u.info) : null, error: r.error ?? null, imported: !!r.source };
    }),
    items: jobItemsSummary(job.id),
    shares: sharesFor(job.id).filter((s) => new Date(s.expires).getTime() > Date.now() && (s.max_downloads == null || s.downloads < s.max_downloads)).map((s) => ({ token: s.token, itemId: s.item_id, expires: s.expires, once: s.max_downloads === 1, downloads: s.downloads })),
  };
}

export const apiV2 = new Elysia({ prefix: "/api" })
  .use(userService)
  .get("/session", async ({ jwt, cookie: { auth } }) => {
    const firstRun = db.query("SELECT 1 FROM users LIMIT 1").get() === null;
    let user: { id: string } | false = false;
    if (auth?.value) user = await jwt.verify(auth.value as string);
    let row = user ? (db.query("SELECT email FROM users WHERE id = ?").get(user.id) as { email: string } | null) : null;
    if (user && !row && !isAnonymousId(user.id)) user = false;
    // Same as the classic home page: with ALLOW_UNAUTHENTICATED a visitor without a session gets an anonymous one.
    if (!user && ALLOW_UNAUTHENTICATED) {
      const id = String(UNAUTHENTICATED_USER_SHARING ? 0 : randomInt(2 ** 24, Math.min(2 ** 48 + 2 ** 24 - 1, Number.MAX_SAFE_INTEGER)));
      auth?.set({ value: await jwt.sign({ id }), httpOnly: true, secure: !HTTP_ALLOWED, maxAge: 24 * 60 * 60, sameSite: "strict" });
      user = { id };
      row = null;
    }
    return { loggedIn: !!user, email: row?.email ?? null, firstRun, registration: ACCOUNT_REGISTRATION, webroot: WEBROOT, account: user && row ? accountBrief(user.id) : null, defaultKeepHours: getSettings().defaultKeepHours, publicUrl: (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "") || null };
  })
  .guard({ auth: true }, (app) =>
    app
      .get("/targets", ({ query }) => {
        const out: Record<string, string[]> = {};
        for (const ext of String(query.exts ?? "").split(",").filter(Boolean).slice(0, 50)) {
          const set = new Set<string>();
          for (const list of Object.values(getPossibleTargets(ext))) list.forEach((x) => set.add(x));
          out[ext] = [...set].sort();
        }
        return out;
      })
      .post("/jobs", ({ user }) => {
        db.query("INSERT INTO jobs (user_id, date_created, status, ui, keep_until) VALUES (?, ?, 'draft', 'v2', ?)").run(user.id, new Date().toISOString(), keepUntil(24));
        const { id } = db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
        return { id };
      })
      .get("/jobs/:id", ({ params, user, status }) => {
        const job = getJob(params.id, user.id);
        if (!job) return status(404, { message: "Not found" });
        return jobView(job);
      })
      .post(
        "/jobs/:id/upload",
        async ({ params, query, request, user, status }) => {
          const job = getJob(params.id, user.id);
          if (!job) return status(404, { message: "Not found" });
          const name = sanitize(String(query.name ?? ""));
          const offset = Number(query.offset ?? 0);
          const total = Number(query.total ?? 0);
          if (!name || !Number.isFinite(offset) || !Number.isFinite(total) || offset < 0 || total <= 0) return status(400, { message: "Bad upload" });
          if (total > MAX_UPLOAD_BYTES) return status(413, { message: `Files can be up to ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB` });
          if (offset === 0) {
            const over = quotaProblem(user.id, total);
            if (over) return status(413, { message: over });
          }

          const dir = uploadsDirFor(user.id, job.id);
          mkdirSync(dir, { recursive: true });
          const file = path.join(dir, name);
          const existing = db.query("SELECT * FROM v2_uploads WHERE job_id = ? AND name = ?").get(job.id, name) as { received: number } | null;
          if (offset === 0) {
            db.query("INSERT INTO v2_uploads (job_id, name, size, received) VALUES (?, ?, ?, 0) ON CONFLICT(job_id, name) DO UPDATE SET size = excluded.size, received = 0, info = NULL").run(job.id, name, total);
          } else if (!existing || existing.received !== offset) {
            return status(409, { message: "Out of order chunk", received: existing?.received ?? 0 });
          }

          const buf = new Uint8Array(await request.arrayBuffer());
          if (offset + buf.length > total) return status(400, { message: "Chunk past end" });
          const fh = await open(file, offset === 0 ? "w" : "r+");
          try {
            await fh.write(buf, 0, buf.length, offset);
          } finally {
            await fh.close();
          }
          const received = offset + buf.length;
          db.query("UPDATE v2_uploads SET received = ? WHERE job_id = ? AND name = ?").run(received, job.id, name);

          if (received < total) return { name, received, complete: false };
          const info = await probe(file, kindOf(extOf(name)));
          db.query("UPDATE v2_uploads SET info = ? WHERE job_id = ? AND name = ?").run(JSON.stringify(info), job.id, name);
          return { name, received, complete: true, info };
        },
        { parse: "none" },
      )
      .delete("/jobs/:id/uploads/:name", ({ params, user, status }) => {
        const job = getJob(params.id, user.id);
        if (!job) return status(404, { message: "Not found" });
        const name = sanitize(decodeURIComponent(params.name));
        rmSync(path.join(uploadsDirFor(user.id, job.id), name), { force: true });
        db.query("DELETE FROM v2_uploads WHERE job_id = ? AND name = ?").run(job.id, name);
        return { ok: true };
      })
      .post(
        "/jobs/:id/start",
        ({ params, body, user, status }) => {
          const job = getJob(params.id, user.id);
          if (!job) return status(404, { message: "Not found" });
          const uploads = new Map(getUploads(job.id).filter((u) => u.received >= u.size).map((u) => [u.name, u]));
          const rows: { recipe: string; opts: string; inputs: string[]; outName: string | null; inSize: number }[] = [];
          for (const it of body.items) {
            const inputs = it.inputs.map((n) => sanitize(n)).filter((n) => uploads.has(n));
            if (!inputs.length) continue;
            if (it.recipe.startsWith(GENERIC_PREFIX)) {
              const target = it.recipe.slice(GENERIC_PREFIX.length);
              if (!/^[a-z0-9.+-]{1,12}$/i.test(target)) continue;
            } else {
              const r = recipeById(it.recipe);
              if (!r) continue;
              if (!r.merge && inputs.length !== 1) continue;
            }
            const outName = it.outName ? sanitize(it.outName) : null;
            rows.push({ recipe: it.recipe, opts: JSON.stringify(it.opts ?? {}), inputs, outName, inSize: inputs.reduce((a, n) => a + (uploads.get(n)?.size ?? 0), 0) });
          }
          if (!rows.length) return status(400, { message: "Nothing to convert" });

          const hours = KEEP_CHOICES.includes(Number(body.keepHours)) ? Number(body.keepHours) : getSettings().defaultKeepHours;
          db.query("UPDATE jobs SET status = 'running', num_files = ?, keep_until = ? WHERE id = ?").run(rows.length, keepUntil(hours), job.id);
          const ins = db.query("INSERT INTO v2_items (job_id, recipe, opts, inputs, out_name, in_size) VALUES (?, ?, ?, ?, ?, ?)");
          for (const r of rows) {
            ins.run(job.id, r.recipe, r.opts, JSON.stringify(r.inputs), r.outName, r.inSize);
            const { id } = db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
            enqueue(id);
          }
          return jobView(getJob(job.id, user.id)!);
        },
        {
          body: t.Object({
            items: t.Array(t.Object({ recipe: t.String(), inputs: t.Array(t.String()), opts: t.Optional(t.Any()), outName: t.Optional(t.String()) }), { maxItems: 500 }),
            keepHours: t.Optional(t.Number()),
          }),
        },
      )
      .post(
        "/jobs/:id/items/:itemId/retry",
        ({ params, body, user, status }) => {
          const job = getJob(params.id, user.id);
          if (!job) return status(404, { message: "Not found" });
          const res = db.query("UPDATE v2_items SET status = 'queued', progress = 0, error = NULL, fixable = 0, tolerant = ? WHERE id = ? AND job_id = ? AND status = 'failed'").run(body.tolerant ? 1 : 0, Number(params.itemId), job.id);
          if (!res.changes) return status(409, { message: "Not retryable" });
          enqueue(Number(params.itemId));
          return jobView(job);
        },
        { body: t.Object({ tolerant: t.Optional(t.Boolean()) }) },
      )
      .get("/jobs/:id/items/:itemId/file", ({ params, query, user, status, set }) => {
        const job = getJob(params.id, user.id);
        if (!job) return status(404, { message: "Not found" });
        const row = db.query("SELECT out_name FROM v2_items WHERE id = ? AND job_id = ? AND status = 'done'").get(Number(params.itemId), job.id) as { out_name: string } | null;
        if (!row) return status(404, { message: "Not found" });
        const file = path.join(outputDirFor(user.id, job.id), sanitize(row.out_name));
        if (!existsSync(file)) return status(410, { message: "This file was already deleted" });
        const disp = query.dl ? "attachment" : "inline";
        set.headers["content-disposition"] = `${disp}; filename*=UTF-8''${encodeURIComponent(row.out_name)}`;
        return Bun.file(file);
      })
      .get("/jobs/:id/zip", async ({ params, user, status }) => {
        const job = getJob(params.id, user.id);
        if (!job) return status(404, { message: "Not found" });
        const dir = path.resolve(outputDirFor(user.id, job.id));
        const names = (db.query("SELECT out_name FROM v2_items WHERE job_id = ? AND status = 'done'").all(job.id) as { out_name: string }[]).map((r) => sanitize(r.out_name)).filter((n) => existsSync(path.join(dir, n)));
        if (!names.length) return status(404, { message: "No files yet" });
        const res = await zipResponse(names.map((n) => path.join(dir, n)), `converted-${job.id}.zip`);
        return res ?? status(500, { message: "Couldn't build the zip" });
      })
      .post(
        "/jobs/:id/keep",
        ({ params, body, user, status }) => {
          const job = getJob(params.id, user.id);
          if (!job) return status(404, { message: "Not found" });
          const hours = KEEP_CHOICES.includes(body.hours) ? body.hours : 24;
          db.query("UPDATE jobs SET keep_until = ? WHERE id = ?").run(keepUntil(hours), job.id);
          return jobView(getJob(job.id, user.id)!);
        },
        { body: t.Object({ hours: t.Number() }) },
      )
      .post(
        "/jobs/:id/import",
        async ({ params, body, user, status }) => {
          const job = getJob(params.id, user.id);
          if (!job) return status(404, { message: "Not found" });
          try {
            const over = quotaProblem(user.id, 0);
            if (over) return status(413, { message: over });
            return await startImport(user.id, job.id, body.url, MAX_UPLOAD_BYTES);
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Couldn't get that file.";
            return status(400, { message: /^Invalid URL|URL/.test(msg) ? "That doesn't look like a link." : msg.includes("timed out") ? "The website took too long to answer." : msg });
          }
        },
        { body: t.Object({ url: t.String({ maxLength: 2000 }) }) },
      )
      .post(
        "/jobs/:id/share",
        ({ params, body, user, status }) => {
          const job = getJob(params.id, user.id);
          if (!job) return status(404, { message: "Not found" });
          if (!(body.choice in SHARE_CHOICES)) return status(400, { message: "Bad choice" });
          const itemId = body.itemId ?? null;
          if (itemId != null && !db.query("SELECT 1 FROM v2_items WHERE id = ? AND job_id = ? AND status = 'done'").get(itemId, job.id)) return status(404, { message: "Not found" });
          const s = createShare(job.id, itemId, body.choice, job.keep_until);
          return { token: s.token, expires: s.expires, once: s.max_downloads === 1 };
        },
        { body: t.Object({ choice: t.String(), itemId: t.Optional(t.Number()) }) },
      )
      .delete("/jobs/:id/share/:token", ({ params, user, status }) => {
        const job = getJob(params.id, user.id);
        if (!job) return status(404, { message: "Not found" });
        db.query("DELETE FROM v2_shares WHERE token = ? AND job_id = ?").run(params.token, job.id);
        return { ok: true };
      })
      .delete("/jobs/:id", ({ params, user, status }) => {
        const job = getJob(params.id, user.id);
        if (!job) return status(404, { message: "Not found" });
        rmSync(outputDirFor(user.id, job.id), { recursive: true, force: true });
        rmSync(uploadsDirFor(user.id, job.id), { recursive: true, force: true });
        deleteV2Rows(job.id);
        db.query("DELETE FROM file_names WHERE job_id = ?").run(job.id);
        db.query("DELETE FROM jobs WHERE id = ?").run(job.id);
        return { ok: true };
      })
      .get("/history", ({ user }) => {
        const jobs = db.query("SELECT * FROM jobs WHERE user_id = ? AND ui = 'v2' AND status != 'draft' ORDER BY id DESC LIMIT 100").all(user.id) as JobRow[];
        return jobs.map((j) => {
          const items = jobItemsSummary(j.id);
          return {
            id: j.id, created: j.date_created, status: j.status, keepUntil: j.keep_until,
            recipes: [...new Set(items.map((i) => i.recipe))],
            inputs: items.reduce((a, i) => a + i.inputs.length, 0),
            done: items.filter((i) => i.status === "done").length,
            failed: items.filter((i) => i.status === "failed").length,
            total: items.length,
            inSize: items.reduce((a, i) => a + i.inSize, 0),
            outSize: items.reduce((a, i) => a + (i.outSize ?? 0), 0),
          };
        });
      })
      .get("/queue", () => queueStats())
      .get("/storage", ({ user }) => {
        const r = db.query("SELECT COALESCE(SUM(i.out_size),0) AS o, COALESCE(SUM(i.in_size),0) AS i FROM v2_items i JOIN jobs j ON j.id = i.job_id WHERE j.user_id = ?").get(user.id) as { o: number; i: number };
        return { used: r.o + r.i, maxUpload: MAX_UPLOAD_BYTES };
      }),
  );

