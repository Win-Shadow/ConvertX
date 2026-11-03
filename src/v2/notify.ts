import { statfsSync } from "node:fs";

import db from "../db/db";
import { getSettings, saveSettings } from "./accounts";
import { recipeById } from "./recipes";
import { hooks } from "./store";

const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "");

async function tg(method: string, body: Record<string, unknown>, token = getSettings().telegramToken): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  if (!token) return { ok: false, description: "No bot token" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35_000),
    });
    return (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

export function send(chat: string, text: string): Promise<unknown> {
  return tg("sendMessage", { chat_id: chat, text, disable_web_page_preview: true });
}

function adminChats(): string[] {
  return (db.query("SELECT telegram_chat FROM users WHERE role = 'admin' AND telegram_chat IS NOT NULL").all() as { telegram_chat: string }[]).map((r) => r.telegram_chat);
}

export async function checkBot(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  const r = await tg("getMe", {}, token);
  if (!r.ok) return { ok: false, error: r.description ?? "Telegram rejected that token" };
  return { ok: true, username: (r.result as { username: string }).username };
}

// ---------- events ----------
hooks.jobDone.push((jobId) => {
  const s = getSettings();
  const job = db.query("SELECT j.id, j.user_id, j.date_created, u.telegram_chat, u.notify_done FROM jobs j JOIN users u ON u.id = j.user_id WHERE j.id = ?").get(jobId) as
    | { id: number; user_id: number; date_created: string; telegram_chat: string | null; notify_done: number }
    | null;
  if (!job?.telegram_chat || !job.notify_done) return;
  const secs = (Date.now() - new Date(job.date_created).getTime()) / 1000;
  if (secs < s.notifyAfterSec) return;
  const items = db.query("SELECT status FROM v2_items WHERE job_id = ?").all(jobId) as { status: string }[];
  const ok = items.filter((i) => i.status === "done").length, bad = items.length - ok;
  const head = bad ? `⚠️ ${ok} of ${items.length} files are ready — ${bad} need a look.` : `✅ Your ${items.length === 1 ? "file is" : `${items.length} files are`} ready.`;
  void send(job.telegram_chat, `${head}${PUBLIC_URL ? `\n${PUBLIC_URL}/?job=${jobId}` : ""}`);
});

hooks.itemFailed.push((itemId) => {
  const s = getSettings();
  if (!s.alertFailures) return;
  const r = db.query("SELECT i.recipe, i.inputs, i.error, i.tolerant, u.email, u.name FROM v2_items i JOIN jobs j ON j.id = i.job_id JOIN users u ON u.id = j.user_id WHERE i.id = ?").get(itemId) as
    | { recipe: string; inputs: string; error: string; tolerant: number; email: string; name: string | null }
    | null;
  if (!r) return;
  const what = recipeById(r.recipe)?.title ?? r.recipe;
  const file = (JSON.parse(r.inputs) as string[])[0] ?? "?";
  for (const chat of adminChats()) void send(chat, `🔧 Convert: ${r.name || r.email}'s ${file} → ${what} failed.\n${r.error}`);
});

// ---------- telegram linking: users tap t.me/<bot>?start=<code> ----------
let offset = 0;
let polling = false;

async function poll(): Promise<void> {
  if (polling || !getSettings().telegramToken) return;
  polling = true;
  try {
    const r = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message"] });
    if (!r.ok || !Array.isArray(r.result)) return;
    for (const up of r.result as { update_id: number; message?: { chat: { id: number }; text?: string } }[]) {
      offset = up.update_id + 1;
      const text = up.message?.text ?? "";
      const chat = up.message?.chat.id;
      if (!chat) continue;
      const code = /^\/start\s+([\w-]{6,40})/.exec(text)?.[1];
      if (!code) {
        if (text.startsWith("/start")) void send(String(chat), "Hi! To get messages from Convert, open My account on the website and tap “Connect Telegram”.");
        continue;
      }
      const user = db.query("SELECT id, name, email FROM users WHERE notify_code = ?").get(code) as { id: number; name: string | null; email: string } | null;
      if (!user) {
        void send(String(chat), "That link has expired. Open My account on the website and tap “Connect Telegram” again.");
        continue;
      }
      db.query("UPDATE users SET telegram_chat = ?, notify_code = NULL WHERE id = ?").run(String(chat), user.id);
      void send(String(chat), `Connected, ${user.name || user.email}! You'll get a message here when a long conversion finishes.`);
    }
  } finally {
    polling = false;
  }
}

// ---------- disk ----------
let lastDiskAlert = 0;
export function diskInfo(): { total: number; free: number } | null {
  try {
    const s = statfsSync("./data");
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

function checkDisk(): void {
  const d = diskInfo();
  const s = getSettings();
  if (!d || !s.alertDiskPct) return;
  const pct = (d.free / d.total) * 100;
  if (pct >= s.alertDiskPct || Date.now() - lastDiskAlert < 12 * 3600_000) return;
  lastDiskAlert = Date.now();
  for (const chat of adminChats()) void send(chat, `💾 Convert: the server is down to ${pct.toFixed(1)}% free space (${(d.free / 1024 ** 3).toFixed(1)} GB).`);
}

export function startNotifier(): void {
  setInterval(() => void poll(), 2_000);
  setInterval(checkDisk, 15 * 60_000);
  void (async () => {
    const s = getSettings();
    if (s.telegramToken && !s.telegramBot) {
      const b = await checkBot(s.telegramToken);
      if (b.ok && b.username) saveSettings({ telegramBot: b.username });
    }
  })();
}
