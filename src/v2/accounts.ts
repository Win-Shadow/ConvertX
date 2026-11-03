import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";

import db from "../db/db";
import { outputDirFor, uploadsDirFor } from "./runner";
import { deleteV2Rows } from "./store";

function cols(table: string): Set<string> {
  return new Set((db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
}

const u = cols("users");
const addCol = (name: string, def: string) => {
  if (!u.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
};
addCol("name", "TEXT");
addCol("role", "TEXT NOT NULL DEFAULT 'user'");
addCol("quota_mb", "INTEGER");
addCol("disabled", "INTEGER NOT NULL DEFAULT 0");
addCol("expires", "TEXT");
addCol("created", "TEXT");
addCol("last_seen", "TEXT");
addCol("prefs", "TEXT");
addCol("telegram_chat", "TEXT");
addCol("notify_code", "TEXT");
addCol("notify_done", "INTEGER NOT NULL DEFAULT 1");

// Whoever set the server up first is the admin.
if (!db.query("SELECT 1 FROM users WHERE role = 'admin'").get()) {
  db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS v2_invites (
    token TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'user',
    note TEXT,
    uses_left INTEGER,
    expires TEXT NOT NULL,
    guest_days INTEGER,
    quota_mb INTEGER,
    created TEXT NOT NULL,
    created_by INTEGER,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS v2_settings (key TEXT PRIMARY KEY, value TEXT);
`);

export type Role = "admin" | "user" | "guest";

export interface Account {
  id: number;
  email: string;
  name: string | null;
  role: Role;
  quota_mb: number | null;
  disabled: number;
  expires: string | null;
  created: string | null;
  last_seen: string | null;
  prefs: string | null;
  telegram_chat: string | null;
  notify_code: string | null;
  notify_done: number;
}

export function getAccount(id: string | number): Account | null {
  return db.query("SELECT id, email, name, role, quota_mb, disabled, expires, created, last_seen, prefs, telegram_chat, notify_code, notify_done FROM users WHERE id = ?").get(id) as Account | null;
}

export function isActive(a: Account | null): boolean {
  if (!a || a.disabled) return false;
  return !a.expires || new Date(a.expires).getTime() > Date.now();
}

let lastSeenWrites = new Map<number, number>();
export function touch(id: number): void {
  const now = Date.now();
  if ((lastSeenWrites.get(id) ?? 0) > now - 5 * 60_000) return;
  lastSeenWrites.set(id, now);
  db.query("UPDATE users SET last_seen = ? WHERE id = ?").run(new Date(now).toISOString(), id);
}

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  defaultQuotaMb: 10240,
  defaultKeepHours: 24,
  telegramToken: "",
  telegramBot: "",

  alertFailures: true,
  alertDiskPct: 10,
  notifyAfterSec: 60,
};
export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(): Settings {
  const rows = db.query("SELECT key, value FROM v2_settings").all() as { key: string; value: string }[];
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue;
    try {
      s[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore bad row */
    }
  }
  return s as Settings;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const ins = db.query("INSERT INTO v2_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    const want = typeof DEFAULT_SETTINGS[k as keyof Settings];
    if (typeof v !== want) continue;
    ins.run(k, JSON.stringify(v));
  }
  return getSettings();
}

// ---------- storage ----------
export function usedBytes(userId: number | string): number {
  const r = db.query("SELECT COALESCE(SUM(i.in_size),0) + COALESCE(SUM(i.out_size),0) AS b FROM v2_items i JOIN jobs j ON j.id = i.job_id WHERE j.user_id = ?").get(userId) as { b: number };
  const pending = db.query("SELECT COALESCE(SUM(MAX(u.size,0)),0) AS b FROM v2_uploads u JOIN jobs j ON j.id = u.job_id WHERE j.user_id = ? AND NOT EXISTS (SELECT 1 FROM v2_items i WHERE i.job_id = u.job_id)").get(userId) as { b: number };
  return r.b + pending.b;
}

export function quotaBytes(a: Account): number {
  if (a.role === "admin") return 0;
  const mb = a.quota_mb ?? getSettings().defaultQuotaMb;
  return mb > 0 ? mb * 1024 * 1024 : 0;
}

// ---------- invites ----------
export interface Invite {
  token: string;
  role: Role;
  note: string | null;
  uses_left: number | null;
  expires: string;
  guest_days: number | null;
  quota_mb: number | null;
  created: string;
  created_by: number | null;
  used: number;
}

export function createInvite(by: number, o: { role: Role; note?: string | undefined; uses?: number | null | undefined; days: number; guestDays?: number | null | undefined; quotaMb?: number | null | undefined }): Invite {
  const inv: Invite = {
    token: randomBytes(12).toString("base64url"),
    role: o.role === "admin" ? "user" : o.role,
    note: o.note?.slice(0, 80) || null,
    uses_left: o.uses ?? null,
    expires: new Date(Date.now() + Math.max(1, Math.min(90, o.days)) * 86400_000).toISOString(),
    guest_days: o.role === "guest" ? Math.max(1, Math.min(90, o.guestDays ?? 3)) : null,
    quota_mb: o.quotaMb ?? null,
    created: new Date().toISOString(),
    created_by: by,
    used: 0,
  };
  db.query("INSERT INTO v2_invites (token, role, note, uses_left, expires, guest_days, quota_mb, created, created_by, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)").run(inv.token, inv.role, inv.note, inv.uses_left, inv.expires, inv.guest_days, inv.quota_mb, inv.created, inv.created_by);
  return inv;
}

export function liveInvite(token: string): Invite | null {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return null;
  const inv = db.query("SELECT * FROM v2_invites WHERE token = ?").get(token) as Invite | null;
  if (!inv) return null;
  if (new Date(inv.expires).getTime() < Date.now()) return null;
  if (inv.uses_left != null && inv.uses_left <= 0) return null;
  return inv;
}

export async function redeemInvite(inv: Invite, email: string, password: string, name: string): Promise<Account> {
  const clean = email.trim().toLowerCase();
  if (db.query("SELECT 1 FROM users WHERE lower(email) = ?").get(clean)) throw new Error("That email already has an account. Log in instead.");
  const hash = await Bun.password.hash(password);
  const now = new Date();
  const expires = inv.role === "guest" && inv.guest_days ? new Date(now.getTime() + inv.guest_days * 86400_000).toISOString() : null;
  db.query("INSERT INTO users (email, password, name, role, quota_mb, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?)").run(clean, hash, name.trim().slice(0, 60) || null, inv.role, inv.quota_mb, now.toISOString(), expires);
  db.query("UPDATE v2_invites SET used = used + 1, uses_left = CASE WHEN uses_left IS NULL THEN NULL ELSE uses_left - 1 END WHERE token = ?").run(inv.token);
  const { id } = db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
  return getAccount(id)!;
}

// ---------- removal ----------
export function deleteUserData(userId: number): void {
  const jobs = db.query("SELECT id FROM jobs WHERE user_id = ?").all(userId) as { id: number }[];
  for (const j of jobs) {
    rmSync(outputDirFor(userId, j.id), { recursive: true, force: true });
    rmSync(uploadsDirFor(userId, j.id), { recursive: true, force: true });
    deleteV2Rows(j.id);
    db.query("DELETE FROM file_names WHERE job_id = ?").run(j.id);
  }
  db.query("DELETE FROM jobs WHERE user_id = ?").run(userId);
}

export function deleteUser(userId: number): void {
  deleteUserData(userId);
  db.query("DELETE FROM users WHERE id = ?").run(userId);
}

// Guest accounts clean themselves up once they expire.
export function sweepGuests(): number {
  const gone = db.query("SELECT id FROM users WHERE role = 'guest' AND expires IS NOT NULL AND expires < ?").all(new Date().toISOString()) as { id: number }[];
  for (const g of gone) deleteUser(g.id);
  return gone.length;
}

export function newNotifyCode(userId: number): string {
  const code = randomBytes(9).toString("base64url");
  db.query("UPDATE users SET notify_code = ? WHERE id = ?").run(code, userId);
  return code;
}
