import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { config, AGENT_LABELS } from './config.ts';
import { db, getCampaign, listCampaigns, listRounds, updateCampaign, type CampaignRow, type RoundRow } from './db.ts';
import { emit, heartbeat, listEvents, subscribe } from './events.ts';
import { getWorkflow, setWorkflowActive } from './evolus.ts';
import { isRunning, requestStop, startCampaign } from './orchestrator.ts';
import { mockRouter } from './mock.ts';
import { parseCurl } from './curl.ts';
import { TargetClient, suggestReplyPaths, type TargetConfig } from './target.ts';

export const api = Router();

function serializeCampaign(c: CampaignRow) {
  return {
    id: c.id,
    name: c.name,
    mode: c.mode,
    status: c.status,
    policy: c.policy,
    target: JSON.parse(c.target_json ?? '{}'),
    maxRounds: c.max_rounds,
    recon: !!c.recon,
    stopWhenSafe: !!c.stop_when_safe,
    authorized: !!c.authorized,
    createdAt: c.created_at,
    startedAt: c.started_at,
    finishedAt: c.finished_at,
    workflowExecutionId: c.workflow_execution_id,
    error: c.error,
    running: isRunning(c.id),
    hasReport: !!c.report_json,
  };
}

export function serializeRound(r: RoundRow) {
  return {
    id: r.id,
    idx: r.idx,
    phase: r.phase,
    probe: r.probe,
    response: r.response,
    verdict: r.verdict_json ? JSON.parse(r.verdict_json) : null,
    status: r.status,
    error: r.error,
    durationMs: r.duration_ms,
    createdAt: r.created_at,
  };
}

api.get('/health', (_req, res) => {
  res.json({ ok: true, app: 'evolus-red-server', time: new Date().toISOString() });
});

api.get('/meta', async (_req, res) => {
  let workflow = null;
  try {
    const wf = await getWorkflow();
    workflow = { id: wf.id, name: wf.name, isActive: wf.isActive, updatedAt: wf.updatedAt };
  } catch (err) {
    workflow = { id: config.evolus.workflowId, name: 'AttackLoop', isActive: null, error: String(err).slice(0, 200) };
  }
  res.json({
    applicationId: config.evolus.applicationId,
    agents: Object.entries(config.evolus.agents).map(([key, id]) => ({ key, label: AGENT_LABELS[key] ?? key, id })),
    workflow,
    mock: { url: '/api/mock/target', info: '/api/mock/target/info' },
    // null = full self-hosted backend; the Vercel serverless deployment sets this
    // to { readOnly: true, note } so the console hides run controls.
    demo: null,
  });
});

/** Parse a pasted cURL command into endpoint / method / headers / body template. */
api.post('/parse-curl', (req, res) => {
  const curl = String((req.body as { curl?: unknown })?.curl ?? '');
  res.json(parseCurl(curl));
});

/** Send one benign hello through the exact target pipeline used by campaigns. */
api.post('/targets/test', async (req, res) => {
  const body = req.body as { target?: TargetConfig };
  const target = body.target ?? (req.body as unknown as TargetConfig);
  if (!target?.url) {
    res.status(400).json({ ok: false, error: 'Missing target.url' });
    return;
  }
  const client = new TargetClient({ ...target, timeoutMs: Math.min(Number(target.timeoutMs) || 20_000, 30_000) });
  try {
    const reply = await client.send('Hello from the EVOLUS RED connection test.');
    res.json({
      ok: reply.httpStatus < 500,
      httpStatus: reply.httpStatus,
      ms: reply.ms,
      extracted: reply.text,
      raw: reply.raw ?? '',
      suggestions: suggestReplyPaths(reply.raw ?? ''),
    });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

api.get('/campaigns', (_req, res) => {
  res.json(listCampaigns().map(serializeCampaign));
});

api.post('/campaigns', (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = String(body.name ?? '').trim() || 'Untitled campaign';
  const mode = body.mode === 'deep' ? 'deep' : 'quick';
  const policy = String(body.policy ?? '').trim();
  const target = (body.target ?? {}) as Record<string, unknown>;
  if (!target.url) {
    res.status(400).json({ error: 'Missing target.url' });
    return;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO campaigns (id, name, mode, status, policy, target_json, max_rounds, recon, stop_when_safe, authorized, created_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    name,
    mode,
    policy,
    JSON.stringify(target),
    Math.max(1, Math.min(12, Number(body.maxRounds ?? 4))),
    body.recon === false ? 0 : 1,
    body.stopWhenSafe === false ? 0 : 1,
    body.authorized ? 1 : 0,
    new Date().toISOString(),
  );
  const campaign = getCampaign(id);
  res.status(201).json(serializeCampaign(campaign!));
});

api.get('/campaigns/:id', (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json({ campaign: serializeCampaign(c), rounds: listRounds(c.id).map(serializeRound) });
});

api.post('/campaigns/:id/start', async (req, res) => {
  try {
    await startCampaign(req.params.id);
    res.status(202).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

api.post('/campaigns/:id/stop', (req, res) => {
  const ok = requestStop(req.params.id);
  res.json({ ok });
});

api.get('/campaigns/:id/events', (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  const after = Number(req.query.after ?? req.headers['last-event-id'] ?? 0) || 0;
  const hb = heartbeat(res);
  res.on('close', () => clearInterval(hb));
  subscribe(c.id, res, after);
});

api.get('/campaigns/:id/events.json', (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json(listEvents(c.id, Number(req.query.after ?? 0) || 0));
});

api.get('/campaigns/:id/report', (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  if (!c.report_json) {
    res.status(404).json({ error: 'No report yet — run the campaign first' });
    return;
  }
  res.json(JSON.parse(c.report_json));
});

api.get('/campaigns/:id/report.md', (req, res) => {
  const c = getCampaign(req.params.id);
  if (!c?.report_json) {
    res.status(404).json({ error: 'No report yet' });
    return;
  }
  const report = JSON.parse(c.report_json) as { markdown: string };
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.send(report.markdown);
});

api.post('/workflow/toggle', async (req, res) => {
  try {
    const active = !!(req.body as { active?: unknown })?.active;
    const result = await setWorkflowActive(active);
    emit('__global__', 'workflow.toggle', { active, result });
    res.json({ ok: true, active, result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

api.use('/mock', mockRouter);
