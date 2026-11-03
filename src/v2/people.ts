import { Elysia, t } from "elysia";

import db from "../db/db";
import { HTTP_ALLOWED } from "../helpers/env";
import { userService } from "../services/user";
import {
  createInvite, deleteUser, deleteUserData, getAccount, getSettings, isActive, liveInvite, newNotifyCode, quotaBytes,
  redeemInvite, saveSettings, sweepGuests, touch, usedBytes, type Account, type Invite, type Role,
} from "./accounts";
import { checkBot, diskInfo, send } from "./notify";
import { queueStats } from "./runner";

const ROLES: Role[] = ["admin", "user", "guest"];

function publicAccount(a: Account) {
  let prefs = {};
  try {
    prefs = a.prefs ? JSON.parse(a.prefs) : {};
  } catch {
    /* bad json: ignore */
  }
  return { id: a.id, email: a.email, name: a.name, role: a.role, expires: a.expires, prefs, telegram: !!a.telegram_chat, notifyDone: !!a.notify_done, quota: quotaBytes(a), used: usedBytes(a.id) };
}

function inviteView(i: Invite) {
  return { token: i.token, role: i.role, note: i.note, usesLeft: i.uses_left, expires: i.expires, guestDays: i.guest_days, quotaMb: i.quota_mb, used: i.used };
}

const cookieOpts = { httpOnly: true, secure: !HTTP_ALLOWED, maxAge: 60 * 60 * 24 * 7, sameSite: "strict" as const };

export const people = new Elysia({ prefix: "/api" })
  .use(userService)
  // ---------- public: login + invites ----------
  .post(
    "/login",
    async ({ body, jwt, cookie: { auth }, status }) => {
      const row = db.query("SELECT id, password FROM users WHERE lower(email) = ?").get(body.email.trim().toLowerCase()) as { id: number; password: string } | null;
      const ok = row ? await Bun.password.verify(body.password, row.password) : false;
      if (!row || !ok) return status(401, { message: "bad" });
      const a = getAccount(row.id);
      if (!isActive(a)) return status(403, { message: a?.disabled ? "disabled" : "expired" });
      auth?.set({ value: await jwt.sign({ id: String(row.id) }), ...cookieOpts });
      touch(row.id);
      return { ok: true };
    },
    { body: t.Object({ email: t.String({ maxLength: 200 }), password: t.String({ maxLength: 500 }) }) },
  )
  .get("/invite/:token", ({ params, status }) => {
    const inv = liveInvite(params.token);
    if (!inv) return status(410, { message: "gone" });
    return { role: inv.role, note: inv.note, guestDays: inv.guest_days };
  })
  .post(
    "/invite/:token",
    async ({ params, body, jwt, cookie: { auth }, status }) => {
      const inv = liveInvite(params.token);
      if (!inv) return status(410, { message: "This invite has expired. Ask for a new one." });
      if (body.password.length < 8) return status(400, { message: "Use at least 8 characters for your password." });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return status(400, { message: "That email doesn't look right." });
      try {
        const a = await redeemInvite(inv, body.email, body.password, body.name);
        auth?.set({ value: await jwt.sign({ id: String(a.id) }), ...cookieOpts });
        for (const chat of (db.query("SELECT telegram_chat FROM users WHERE role = 'admin' AND telegram_chat IS NOT NULL").all() as { telegram_chat: string }[]).map((r) => r.telegram_chat)) {
          void send(chat, `👋 Convert: ${a.name || a.email} joined${a.role === "guest" ? " as a guest" : ""}.`);
        }
        return { ok: true };
      } catch (e) {
        return status(400, { message: e instanceof Error ? e.message : "Couldn't create the account." });
      }
    },
    { body: t.Object({ email: t.String({ maxLength: 200 }), password: t.String({ maxLength: 500 }), name: t.String({ maxLength: 60 }) }) },
  )
  // ---------- signed in ----------
  .guard({ auth: true }, (app) =>
    app
      .get("/me", ({ user, status }) => {
        const a = getAccount(user.id);
        if (!isActive(a)) return status(401, { message: "Unauthorized" });
        touch(a!.id);
        return { ...publicAccount(a!), bot: getSettings().telegramBot || null };
      })
      .put(
        "/me",
        ({ user, body }) => {
          if (body.name !== undefined) db.query("UPDATE users SET name = ? WHERE id = ?").run(body.name.trim().slice(0, 60) || null, user.id);
          if (body.prefs !== undefined) db.query("UPDATE users SET prefs = ? WHERE id = ?").run(JSON.stringify(body.prefs).slice(0, 2000), user.id);
          if (body.notifyDone !== undefined) db.query("UPDATE users SET notify_done = ? WHERE id = ?").run(body.notifyDone ? 1 : 0, user.id);
          return publicAccount(getAccount(user.id)!);
        },
        {
          body: t.Object({
            name: t.Optional(t.String({ maxLength: 60 })),
            prefs: t.Optional(t.Object({ theme: t.Optional(t.String({ maxLength: 20 })), mode: t.Optional(t.String({ maxLength: 10 })), lang: t.Optional(t.String({ maxLength: 5 })) })),
            notifyDone: t.Optional(t.Boolean()),
          }),
        },
      )
      .post(
        "/me/password",
        async ({ user, body, status }) => {
          const row = db.query("SELECT password FROM users WHERE id = ?").get(user.id) as { password: string } | null;
          if (!row || !(await Bun.password.verify(body.current, row.password))) return status(400, { message: "Your current password isn't right." });
          if (body.next.length < 8) return status(400, { message: "Use at least 8 characters." });
          db.query("UPDATE users SET password = ? WHERE id = ?").run(await Bun.password.hash(body.next), user.id);
          return { ok: true };
        },
        { body: t.Object({ current: t.String({ maxLength: 500 }), next: t.String({ maxLength: 500 }) }) },
      )
      .post("/me/telegram", ({ user, status }) => {
        const bot = getSettings().telegramBot;
        if (!bot) return status(409, { message: "Telegram isn't set up on this server yet." });
        return { url: `https://t.me/${bot}?start=${newNotifyCode(Number(user.id))}` };
      })
      .delete("/me/telegram", ({ user }) => {
        db.query("UPDATE users SET telegram_chat = NULL, notify_code = NULL WHERE id = ?").run(user.id);
        return { ok: true };
      })
      // ---------- admin ----------
      .guard(
        {
          beforeHandle({ user, status }) {
            if (getAccount(user.id)?.role !== "admin") return status(403, { message: "Admins only" });
          },
        },
        (admin) =>
          admin
            .get("/admin/overview", () => {
              const since = new Date(Date.now() - 86400_000).toISOString();
              const jobsToday = (db.query("SELECT COUNT(*) AS n FROM jobs WHERE ui = 'v2' AND status != 'draft' AND date_created > ?").get(since) as { n: number }).n;
              const failed = db.query(
                `SELECT i.id, i.job_id AS jobId, i.recipe, i.inputs, i.error, i.detail, i.finished, u.email, u.name
                 FROM v2_items i JOIN jobs j ON j.id = i.job_id JOIN users u ON u.id = j.user_id
                 WHERE i.status = 'failed' ORDER BY i.finished DESC LIMIT 25`,
              ).all() as { inputs: string }[];
              const stored = (db.query("SELECT COALESCE(SUM(in_size),0) + COALESCE(SUM(out_size),0) AS b FROM v2_items").get() as { b: number }).b;
              return {
                disk: diskInfo(),
                stored,
                queue: queueStats(),
                jobsToday,
                failures24h: failed.filter((f) => ((f as unknown as { finished: string }).finished ?? "") > since).length,
                failed: failed.map((f) => ({ ...f, inputs: JSON.parse(f.inputs) })),
                settings: { ...getSettings(), telegramToken: getSettings().telegramToken ? "••••" : "" },
              };
            })
            .get("/admin/users", () => {
              const rows = db.query("SELECT id FROM users ORDER BY id").all() as { id: number }[];
              return rows.map((r) => {
                const a = getAccount(r.id)!;
                const jobs = (db.query("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status != 'draft'").get(a.id) as { n: number }).n;
                return { ...publicAccount(a), disabled: !!a.disabled, quotaMb: a.quota_mb, created: a.created, lastSeen: a.last_seen, jobs };
              });
            })
            .put(
              "/admin/users/:id",
              ({ params, body, user, status }) => {
                const a = getAccount(params.id);
                if (!a) return status(404, { message: "Not found" });
                const self = String(a.id) === String(user.id);
                if (self && (body.role && body.role !== "admin" || body.disabled)) return status(400, { message: "You can't demote or disable yourself." });
                if (body.role !== undefined && ROLES.includes(body.role as Role)) db.query("UPDATE users SET role = ?, expires = CASE WHEN ? = 'guest' THEN expires ELSE NULL END WHERE id = ?").run(body.role, body.role, a.id);
                if (body.quotaMb !== undefined) db.query("UPDATE users SET quota_mb = ? WHERE id = ?").run(body.quotaMb, a.id);
                if (body.disabled !== undefined) db.query("UPDATE users SET disabled = ? WHERE id = ?").run(body.disabled ? 1 : 0, a.id);
                if (body.name !== undefined) db.query("UPDATE users SET name = ? WHERE id = ?").run(body.name.trim() || null, a.id);
                if (body.expiresDays !== undefined) db.query("UPDATE users SET expires = ? WHERE id = ?").run(body.expiresDays ? new Date(Date.now() + body.expiresDays * 86400_000).toISOString() : null, a.id);
                return { ok: true };
              },
              {
                body: t.Object({
                  role: t.Optional(t.String()),
                  quotaMb: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
                  disabled: t.Optional(t.Boolean()),
                  name: t.Optional(t.String({ maxLength: 60 })),
                  expiresDays: t.Optional(t.Union([t.Number({ minimum: 1, maximum: 365 }), t.Null()])),
                }),
              },
            )
            .post("/admin/users/:id/password", async ({ params, status }) => {
              const a = getAccount(params.id);
              if (!a) return status(404, { message: "Not found" });
              const words = ["sun", "river", "maple", "cloud", "tiger", "pepper", "ocean", "lemon", "piano", "rocket", "cactus", "mango"];
              const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0]! % words.length];
              const temp = `${pick()}-${pick()}-${crypto.getRandomValues(new Uint32Array(1))[0]! % 900 + 100}`;
              db.query("UPDATE users SET password = ? WHERE id = ?").run(await Bun.password.hash(temp), a.id);
              return { password: temp };
            })
            .delete("/admin/users/:id/files", ({ params, status }) => {
              const a = getAccount(params.id);
              if (!a) return status(404, { message: "Not found" });
              deleteUserData(a.id);
              return { ok: true };
            })
            .delete("/admin/users/:id", ({ params, user, status }) => {
              const a = getAccount(params.id);
              if (!a) return status(404, { message: "Not found" });
              if (String(a.id) === String(user.id)) return status(400, { message: "You can't delete yourself." });
              deleteUser(a.id);
              return { ok: true };
            })
            .get("/admin/invites", () => {
              const rows = db.query("SELECT * FROM v2_invites WHERE expires > ? AND (uses_left IS NULL OR uses_left > 0) ORDER BY created DESC").all(new Date().toISOString()) as Invite[];
              return rows.map(inviteView);
            })
            .post(
              "/admin/invites",
              ({ body, user }) => inviteView(createInvite(Number(user.id), { role: body.role === "guest" ? "guest" : "user", note: body.note, uses: body.uses ?? null, days: body.days, guestDays: body.guestDays ?? null, quotaMb: body.quotaMb ?? null })),
              {
                body: t.Object({
                  role: t.String(),
                  note: t.Optional(t.String({ maxLength: 80 })),
                  uses: t.Optional(t.Union([t.Number({ minimum: 1, maximum: 100 }), t.Null()])),
                  days: t.Number({ minimum: 1, maximum: 90 }),
                  guestDays: t.Optional(t.Union([t.Number({ minimum: 1, maximum: 90 }), t.Null()])),
                  quotaMb: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
                }),
              },
            )
            .delete("/admin/invites/:token", ({ params }) => {
              db.query("DELETE FROM v2_invites WHERE token = ?").run(params.token);
              return { ok: true };
            })
            .put(
              "/admin/settings",
              async ({ body, status }) => {
                const patch: Record<string, unknown> = { ...body };
                if (typeof body.telegramToken === "string") {
                  if (body.telegramToken === "") patch.telegramBot = "";
                  else if (body.telegramToken === "••••") delete patch.telegramToken;
                  else {
                    const b = await checkBot(body.telegramToken.trim());
                    if (!b.ok) return status(400, { message: `Telegram didn't accept that token: ${b.error}` });
                    patch.telegramToken = body.telegramToken.trim();
                    patch.telegramBot = b.username;
                  }
                }
                const s = saveSettings(patch);
                return { ...s, telegramToken: s.telegramToken ? "••••" : "" };
              },
              {
                body: t.Object({
                  defaultQuotaMb: t.Optional(t.Number({ minimum: 0 })),
                  defaultKeepHours: t.Optional(t.Number()),
                  telegramToken: t.Optional(t.String({ maxLength: 100 })),
                  alertFailures: t.Optional(t.Boolean()),
                  alertDiskPct: t.Optional(t.Number({ minimum: 0, maximum: 50 })),
                  notifyAfterSec: t.Optional(t.Number({ minimum: 0, maximum: 3600 })),
                }),
              },
            )
            .post("/admin/test-telegram", async ({ user, status }) => {
              const a = getAccount(user.id);
              if (!a?.telegram_chat) return status(409, { message: "Connect your own Telegram first (My account)." });
              await send(a.telegram_chat, "🔔 Test from Convert — alerts will arrive here.");
              return { ok: true };
            }),
      ),
  );

export function startSweeper(): void {
  setInterval(() => {
    const n = sweepGuests();
    if (n) console.log(`[v2] removed ${n} expired guest account(s)`);
  }, 60 * 60_000);
  sweepGuests();
}
