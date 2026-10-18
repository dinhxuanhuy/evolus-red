/**
 * Export the local SQLite history into api-lib/seed-data.ts so the static
 * Vercel demo deployment can serve real recorded campaigns (read-only).
 *
 * Run after recording new runs:
 *   cd server && node scripts/export-demo-seed.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, listCampaigns, listRounds, type CampaignRow, type RoundRow } from '../src/db.ts';

type EventRow = {
  campaign_id: string;
  seq: number;
  ts: string;
  type: string;
  data_json: string;
};

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Mirrors serializeCampaign() in server/src/routes.ts. */
function campaignView(c: CampaignRow) {
  return {
    id: c.id,
    name: c.name,
    mode: c.mode,
    status: c.status,
    policy: c.policy,
    target: safeParse<Record<string, unknown>>(c.target_json, {}),
    maxRounds: c.max_rounds,
    recon: !!c.recon,
    stopWhenSafe: !!c.stop_when_safe,
    authorized: !!c.authorized,
    createdAt: c.created_at,
    startedAt: c.started_at,
    finishedAt: c.finished_at,
    workflowExecutionId: c.workflow_execution_id,
    error: c.error,
    running: false, // seeded history is never "running" on the demo deployment
    hasReport: !!c.report_json,
  };
}

/** Mirrors serializeRound() in server/src/routes.ts. */
function roundView(r: RoundRow) {
  return {
    id: r.id,
    idx: r.idx,
    phase: r.phase,
    probe: r.probe,
    response: r.response,
    verdict: safeParse<unknown>(r.verdict_json, null),
    status: r.status,
    error: r.error,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

/** Mirrors listEvents() in server/src/events.ts. */
function eventView(r: EventRow) {
  return {
    campaign_id: r.campaign_id,
    seq: r.seq,
    ts: r.ts,
    type: r.type,
    data: safeParse<unknown>(r.data_json, {}),
  };
}

const campaigns = listCampaigns();
const campaignById: Record<string, unknown> = {};
const roundsByCampaign: Record<string, unknown[]> = {};
const eventsByCampaign: Record<string, unknown[]> = {};
const reportsByCampaign: Record<string, unknown> = {};

for (const c of campaigns) {
  campaignById[c.id] = campaignView(c);
  roundsByCampaign[c.id] = listRounds(c.id).map(roundView);
  const eventRows = db
    .prepare('SELECT * FROM events WHERE campaign_id = ? ORDER BY seq ASC')
    .all(c.id) as EventRow[];
  eventsByCampaign[c.id] = eventRows.map(eventView);
  const report = safeParse<unknown>(c.report_json, null);
  if (report) reportsByCampaign[c.id] = report;
}

const exportedAt = new Date().toISOString();
const seed = {
  exportedAt,
  campaigns: campaigns.map(campaignView),
  campaignById,
  roundsByCampaign,
  eventsByCampaign,
  reportsByCampaign,
};

const header = `/**
 * AUTO-GENERATED — do not edit by hand.
 *
 * Real recorded campaigns exported from the local SQLite DB, served read-only
 * by the Vercel demo API (api/). Regenerate after recording new runs:
 *   cd server && node scripts/export-demo-seed.ts
 *
 * Exported at: ${exportedAt}
 */
const demoSeed = ${JSON.stringify(seed, null, 2)};

module.exports = { demoSeed };
`;

const target = path.join(import.meta.dirname, '..', '..', 'api-lib', 'seed-data.js');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, header);

const stats = {
  target,
  campaigns: campaigns.length,
  rounds: Object.values(roundsByCampaign).reduce((n, l) => n + l.length, 0),
  events: Object.values(eventsByCampaign).reduce((n, l) => n + l.length, 0),
  reports: Object.keys(reportsByCampaign).length,
  kb: Math.round(header.length / 1024),
};
console.log(JSON.stringify(stats, null, 2));
