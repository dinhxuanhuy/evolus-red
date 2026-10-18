import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEMO, DEMO_NOTE, methodNotAllowed, notFound, readJsonBody, sendJson, sendText } from '../api-lib/http.js';
import { demoSeed } from '../api-lib/seed-data.js';
import { parseCurl } from '../api-lib/curl.js';
import { TargetClient, suggestReplyPaths } from '../api-lib/target.js';
import { MOCK_INFO, mockChat } from '../api-lib/mock.js';

/**
 * Single Vercel function for the whole demo API. All /api/* requests are
 * rewritten here (see vercel.json) and routed internally, because the
 * file-based routing of standalone functions cannot match multi-segment
 * dynamic routes and the Hobby plan caps a deployment at 12 functions.
 *
 * Read-only demo: recorded campaigns from api-lib/seed-data.js; cURL parsing,
 * connection tests, the live Evolus workflow status and the mock target all
 * run for real. Everything that needs the background loop (start/stop/SSE)
 * answers 501 pointing at the self-hosted backend.
 */

const BASE_URL = 'https://api.evolus.ai';

const AGENT_DEFS: [string, string, string][] = [
  ['recon', 'ReconAgent', 'EVOLUS_RECON_AGENT'],
  ['attacker', 'RedTeamAttacker', 'EVOLUS_ATTACKER_AGENT'],
  ['judge', 'ExplainJudge', 'EVOLUS_JUDGE_AGENT'],
  ['planner', 'Planner', 'EVOLUS_PLANNER_AGENT'],
];

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://localhost');
}

/**
 * Segments of the wrapped /api path. Supports both the rewritten
 * "/api/index?__path=a/b" form and direct "/api/a/b" hits (local tests).
 */
function apiPath(req: IncomingMessage): string[] {
  const url = requestUrl(req);
  const override = url.searchParams.get('__path');
  const raw = override ? override : url.pathname.replace(/^\/api(\/|$)/, '');
  return raw.split('/').filter(Boolean);
}

const query = (req: IncomingMessage, key: string): string | null => requestUrl(req).searchParams.get(key);

/* ---------------------------------- /api/meta ------------------------------ */

type WorkflowView = { id: string; name: string; isActive: boolean | null; updatedAt?: string; error?: string };

async function fetchWorkflow(apiKey: string, applicationId: string, workflowId: string): Promise<WorkflowView> {
  if (!apiKey || !applicationId || !workflowId) {
    return {
      id: workflowId,
      name: 'AttackLoop',
      isActive: null,
      error: 'Evolus API key not configured on this deployment',
    };
  }
  try {
    const r = await fetch(`${BASE_URL}/api/v1/workflows/${workflowId}`, {
      headers: { 'X-ApiKey': apiKey, 'X-Application-Id': applicationId },
      signal: AbortSignal.timeout(8000),
    });
    const wf = (await r.json().catch(() => ({}))) as {
      id?: string;
      name?: string;
      isActive?: boolean;
      updatedAt?: string;
    };
    if (!r.ok) {
      return { id: workflowId, name: wf.name ?? 'AttackLoop', isActive: null, error: `Evolus API responded ${r.status}` };
    }
    return { id: wf.id ?? workflowId, name: wf.name ?? 'AttackLoop', isActive: wf.isActive ?? null, updatedAt: wf.updatedAt };
  } catch (err) {
    return { id: workflowId, name: 'AttackLoop', isActive: null, error: String(err).slice(0, 200) };
  }
}

async function metaView(): Promise<Record<string, unknown>> {
  const apiKey = process.env.EVOLUS_API_KEY ?? '';
  const applicationId = process.env.EVOLUS_APPLICATION_ID ?? '';
  const workflowId = process.env.EVOLUS_WORKFLOW_ID ?? '';
  return {
    applicationId,
    agents: AGENT_DEFS.map(([key, label, env]) => ({ key, label, id: process.env[env] ?? '' })),
    workflow: await fetchWorkflow(apiKey, applicationId, workflowId),
    mock: { url: '/api/mock/target', info: '/api/mock/target/info' },
    demo: DEMO,
  };
}

/* -------------------------------- /api/campaigns --------------------------- */

function campaignsRoute(req: IncomingMessage, res: ServerResponse, id: string, action: string): void {
  if (!id) {
    if (req.method === 'GET') {
      sendJson(res, 200, demoSeed.campaigns);
      return;
    }
    if (req.method === 'POST') {
      sendJson(res, 501, { error: DEMO_NOTE });
      return;
    }
    methodNotAllowed(res, ['GET', 'POST']);
    return;
  }

  const campaign = demoSeed.campaignById[id];
  if (!campaign) {
    notFound(res, 'Campaign');
    return;
  }

  if (!action) {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET']);
      return;
    }
    sendJson(res, 200, { campaign, rounds: demoSeed.roundsByCampaign[id] ?? [] });
    return;
  }

  switch (action) {
    case 'report': {
      if (req.method !== 'GET') return void methodNotAllowed(res, ['GET']);
      const report = demoSeed.reportsByCampaign[id];
      if (!report) return void sendJson(res, 404, { error: 'No report yet — run the campaign first' });
      return void sendJson(res, 200, report);
    }

    case 'report.md': {
      if (req.method !== 'GET') return void methodNotAllowed(res, ['GET']);
      const report = demoSeed.reportsByCampaign[id] as { markdown?: string } | undefined;
      if (!report?.markdown) return void sendText(res, 404, 'No report yet');
      return void sendText(res, 200, report.markdown, 'text/markdown; charset=utf-8');
    }

    case 'events.json': {
      if (req.method !== 'GET') return void methodNotAllowed(res, ['GET']);
      const after = Number(query(req, 'after') ?? 0) || 0;
      const events = (demoSeed.eventsByCampaign[id] ?? []) as { seq: number }[];
      return void sendJson(
        res,
        200,
        events.filter((e) => e.seq > after),
      );
    }

    case 'events': {
      if (req.method !== 'GET') return void methodNotAllowed(res, ['GET']);
      return void sendJson(res, 501, { error: DEMO_NOTE });
    }

    case 'start':
    case 'stop': {
      if (req.method !== 'POST') return void methodNotAllowed(res, ['POST']);
      return void sendJson(res, 501, { error: DEMO_NOTE });
    }

    default:
      notFound(res, `Route /campaigns/${id}/${action}`);
  }
}

/* --------------------------------- /api/mock -------------------------------- */

async function mockRoute(req: IncomingMessage, res: ServerResponse, second: string, third: string): Promise<void> {
  if (second !== 'target') {
    notFound(res, 'Mock route');
    return;
  }
  if (!third && req.method === 'POST') {
    const body = await readJsonBody(req);
    const sid = String(req.headers['x-session-id'] ?? '') || undefined;
    const result = mockChat(String(body.message ?? ''), sid);
    res.setHeader('X-Session-Id', result.sessionId);
    sendJson(res, 200, result);
    return;
  }
  if (!third) {
    methodNotAllowed(res, ['POST']);
    return;
  }
  if (third === 'info' && req.method === 'GET') {
    sendJson(res, 200, MOCK_INFO);
    return;
  }
  notFound(res, `Mock route /${[second, third].join('/')}`);
}

/* ---------------------------------- router ---------------------------------- */

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const seg = apiPath(req);
  const [head = '', second = '', third = ''] = seg;

  switch (head) {
    case 'health': {
      if (req.method !== 'GET') return void methodNotAllowed(res, ['GET']);
      return void sendJson(res, 200, { ok: true, app: 'evolus-red-api (vercel demo)', time: new Date().toISOString() });
    }

    case 'meta': {
      if (req.method !== 'GET') return void methodNotAllowed(res, ['GET']);
      return void sendJson(res, 200, await metaView());
    }

    case 'parse-curl': {
      if (req.method !== 'POST') return void methodNotAllowed(res, ['POST']);
      const body = await readJsonBody(req);
      return void sendJson(res, 200, parseCurl(String(body.curl ?? '')));
    }

    case 'targets': {
      if (second !== 'test') break;
      if (req.method !== 'POST') return void methodNotAllowed(res, ['POST']);
      const body = await readJsonBody(req);
      const target = (body.target ?? body) as { url?: string; timeoutMs?: number };
      if (!target?.url) return void sendJson(res, 400, { ok: false, error: 'Missing target.url' });
      const client = new TargetClient({ ...target, timeoutMs: Math.min(Number(target.timeoutMs) || 20_000, 30_000) });
      try {
        const reply = await client.send('Hello from the EVOLUS RED connection test.');
        return void sendJson(res, 200, {
          ok: reply.httpStatus < 500,
          httpStatus: reply.httpStatus,
          ms: reply.ms,
          extracted: reply.text,
          raw: reply.raw ?? '',
          suggestions: suggestReplyPaths(reply.raw ?? ''),
        });
      } catch (err) {
        return void sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }

    case 'workflow': {
      if (second !== 'toggle') break;
      if (req.method !== 'POST') return void methodNotAllowed(res, ['POST']);
      return void sendJson(res, 501, { error: DEMO_NOTE });
    }

    case 'campaigns': {
      return campaignsRoute(req, res, second, third);
    }

    case 'mock': {
      return await mockRoute(req, res, second, third);
    }
  }

  notFound(res, `Route /api/${seg.join('/')}`);
}
