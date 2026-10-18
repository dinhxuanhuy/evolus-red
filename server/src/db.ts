import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

// DATA_DIR lets the SQLite file live on a mounted volume (Railway/Render/Fly);
// defaults to server/data for local runs.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(import.meta.dirname, '../data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'evolus-red.db'));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'quick',
  status TEXT NOT NULL DEFAULT 'draft',
  policy TEXT NOT NULL DEFAULT '',
  target_json TEXT NOT NULL DEFAULT '{}',
  max_rounds INTEGER NOT NULL DEFAULT 4,
  recon INTEGER NOT NULL DEFAULT 1,
  stop_when_safe INTEGER NOT NULL DEFAULT 1,
  authorized INTEGER NOT NULL DEFAULT 0,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  workflow_execution_id TEXT,
  report_json TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  phase TEXT NOT NULL,
  probe TEXT,
  response TEXT,
  verdict_json TEXT,
  meta_json TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  error TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rounds_campaign ON rounds(campaign_id, id);

CREATE TABLE IF NOT EXISTS events (
  campaign_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON events(campaign_id, seq);
`);

export type CampaignRow = {
  id: string;
  name: string;
  mode: string;
  status: string;
  policy: string;
  target_json: string;
  max_rounds: number;
  recon: number;
  stop_when_safe: number;
  authorized: number;
  stop_requested: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  workflow_execution_id: string | null;
  report_json: string | null;
  error: string | null;
};

export type RoundRow = {
  id: number;
  campaign_id: string;
  idx: number;
  phase: string;
  probe: string | null;
  response: string | null;
  verdict_json: string | null;
  meta_json: string | null;
  status: string;
  error: string | null;
  duration_ms: number | null;
  created_at: string;
};

export function getCampaign(id: string): CampaignRow | undefined {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
}

export function listCampaigns(): CampaignRow[] {
  return db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all() as CampaignRow[];
}

export function listRounds(campaignId: string): RoundRow[] {
  return db
    .prepare('SELECT * FROM rounds WHERE campaign_id = ? ORDER BY idx ASC, id ASC')
    .all(campaignId) as RoundRow[];
}

export function updateCampaign(id: string, patch: Partial<CampaignRow>): void {
  const keys = Object.keys(patch);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (patch as Record<string, unknown>)[k] as never);
  db.prepare(`UPDATE campaigns SET ${sets} WHERE id = ?`).run(...values, id);
}

/** Wipe a campaign's run data so a re-run starts clean. */
export function clearCampaignData(campaignId: string): void {
  db.prepare('DELETE FROM rounds WHERE campaign_id = ?').run(campaignId);
  db.prepare('DELETE FROM events WHERE campaign_id = ?').run(campaignId);
}
