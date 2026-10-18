import type { Response } from 'express';
import { db } from './db.ts';

/**
 * Per-campaign event bus. Every event is persisted (for replay to late
 * subscribers) and broadcast to live SSE clients.
 */

export type AppEvent = {
  campaign_id: string;
  seq: number;
  ts: string;
  type: string;
  data: unknown;
};

const clients = new Map<string, Set<Response>>();

function nextSeq(campaignId: string): number {
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM events WHERE campaign_id = ?')
    .get(campaignId) as { s: number };
  return row.s + 1;
}

export function emit(campaignId: string, type: string, data: unknown = {}): AppEvent {
  const ev: AppEvent = {
    campaign_id: campaignId,
    seq: nextSeq(campaignId),
    ts: new Date().toISOString(),
    type,
    data,
  };
  db.prepare('INSERT INTO events (campaign_id, seq, ts, type, data_json) VALUES (?, ?, ?, ?, ?)').run(
    campaignId,
    ev.seq,
    ev.ts,
    ev.type,
    JSON.stringify(ev.data),
  );
  const set = clients.get(campaignId);
  if (set) {
    const payload = format(ev);
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }
  return ev;
}

function format(ev: AppEvent): string {
  return `id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`;
}

const effectiveAfter = (campaignId: string, afterSeq: number): number => {
  if (afterSeq <= 0) return afterSeq;
  const row = db
    .prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM events WHERE campaign_id = ?')
    .get(campaignId) as { s: number };
  // a re-run clears the log and seq restarts — a stale client replays from 0 instead of stalling
  return row.s < afterSeq ? 0 : afterSeq;
};

export function subscribe(campaignId: string, res: Response, afterSeq = 0): void {
  const rows = db
    .prepare('SELECT * FROM events WHERE campaign_id = ? AND seq > ? ORDER BY seq ASC')
    .all(campaignId, effectiveAfter(campaignId, afterSeq)) as { campaign_id: string; seq: number; ts: string; type: string; data_json: string }[];
  for (const r of rows) {
    res.write(
      format({ campaign_id: r.campaign_id, seq: r.seq, ts: r.ts, type: r.type, data: JSON.parse(r.data_json) }),
    );
  }
  let set = clients.get(campaignId);
  if (!set) {
    set = new Set();
    clients.set(campaignId, set);
  }
  set.add(res);
  res.on('close', () => set?.delete(res));
}

export function listEvents(campaignId: string, afterSeq = 0): AppEvent[] {
  const rows = db
    .prepare('SELECT * FROM events WHERE campaign_id = ? AND seq > ? ORDER BY seq ASC')
    .all(campaignId, effectiveAfter(campaignId, afterSeq)) as { campaign_id: string; seq: number; ts: string; type: string; data_json: string }[];
  return rows.map((r) => ({
    campaign_id: r.campaign_id,
    seq: r.seq,
    ts: r.ts,
    type: r.type,
    data: JSON.parse(r.data_json),
  }));
}

export function heartbeat(res: Response): NodeJS.Timeout {
  return setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* closed */
    }
  }, 25_000);
}
