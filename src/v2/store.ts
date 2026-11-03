import db from "../db/db";

function hasColumn(table: string, col: string): boolean {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols.some((c) => c.name === col);
}

if (!hasColumn("jobs", "keep_until")) db.exec("ALTER TABLE jobs ADD COLUMN keep_until TEXT");
if (!hasColumn("jobs", "ui")) db.exec("ALTER TABLE jobs ADD COLUMN ui TEXT");

db.exec(`
  CREATE TABLE IF NOT EXISTS v2_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    received INTEGER NOT NULL DEFAULT 0,
    info TEXT,
    UNIQUE(job_id, name)
  );
  CREATE TABLE IF NOT EXISTS v2_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    recipe TEXT NOT NULL,
    opts TEXT NOT NULL DEFAULT '{}',
    inputs TEXT NOT NULL,
    out_name TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    fixable INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    in_size INTEGER NOT NULL DEFAULT 0,
    out_size INTEGER,
    tolerant INTEGER NOT NULL DEFAULT 0,
    finished TEXT
  );
  CREATE INDEX IF NOT EXISTS v2_items_job ON v2_items(job_id);
  CREATE INDEX IF NOT EXISTS v2_uploads_job ON v2_uploads(job_id);
`);

export interface JobRow {
  id: number;
  user_id: number;
  date_created: string;
  status: string;
  num_files: number;
  keep_until: string | null;
  ui: string | null;
}

export interface UploadRow {
  id: number;
  job_id: number;
  name: string;
  size: number;
  received: number;
  info: string | null;
}

export interface ItemRow {
  id: number;
  job_id: number;
  recipe: string;
  opts: string;
  inputs: string;
  out_name: string | null;
  status: string;
  progress: number;
  error: string | null;
  fixable: number;
  detail: string | null;
  in_size: number;
  out_size: number | null;
  tolerant: number;
  finished: string | null;
}

export function getJob(id: string | number, userId: string | number): JobRow | null {
  return db.query("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId) as JobRow | null;
}

export function getItems(jobId: number): ItemRow[] {
  return db.query("SELECT * FROM v2_items WHERE job_id = ? ORDER BY id").all(jobId) as ItemRow[];
}

export function getUploads(jobId: number): UploadRow[] {
  return db.query("SELECT * FROM v2_uploads WHERE job_id = ? ORDER BY id").all(jobId) as UploadRow[];
}

export function updateItem(id: number, fields: Partial<ItemRow>): void {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE v2_items SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  db.query(sql).run(...(keys.map((k) => (fields as Record<string, unknown>)[k]) as (string | number | null)[]), id);
}

// Notification hooks live here so runner/notify don't import each other.
export const hooks = {
  jobDone: [] as ((jobId: number) => void)[],
  itemFailed: [] as ((itemId: number) => void)[],
};

export function refreshJobStatus(jobId: number): void {
  const items = getItems(jobId);
  if (!items.length) return;
  const busy = items.some((i) => i.status === "queued" || i.status === "running");
  const before = db.query("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string } | null;
  db.query("UPDATE jobs SET status = ? WHERE id = ?").run(busy ? "running" : "completed", jobId);
  if (!busy && before?.status !== "completed") for (const h of hooks.jobDone) h(jobId);
}

export function deleteV2Rows(jobId: number): void {
  db.query("DELETE FROM v2_items WHERE job_id = ?").run(jobId);
  db.query("DELETE FROM v2_uploads WHERE job_id = ?").run(jobId);
  db.query("DELETE FROM v2_shares WHERE job_id = ?").run(jobId);
}

export { db };

db.exec(`
  CREATE TABLE IF NOT EXISTS v2_shares (
    token TEXT PRIMARY KEY,
    job_id INTEGER NOT NULL,
    item_id INTEGER,
    expires TEXT NOT NULL,
    max_downloads INTEGER,
    downloads INTEGER NOT NULL DEFAULT 0,
    created TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS v2_shares_job ON v2_shares(job_id);
`);
{
  const cols = db.query("PRAGMA table_info(v2_uploads)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "error")) db.exec("ALTER TABLE v2_uploads ADD COLUMN error TEXT");
  if (!cols.some((c) => c.name === "source")) db.exec("ALTER TABLE v2_uploads ADD COLUMN source TEXT");
}

export interface ShareRow {
  token: string;
  job_id: number;
  item_id: number | null;
  expires: string;
  max_downloads: number | null;
  downloads: number;
  created: string;
}
