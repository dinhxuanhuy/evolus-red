/**
 * Shared helpers for the Vercel serverless API (static demo deployment).
 * Plain CommonJS on purpose: Vercel compiles the functions in api/ to CJS,
 * which can neither resolve `.ts` specifiers nor require ES modules.
 *
 * The full live backend (background loop + SSE + SQLite) lives in server/
 * and runs self-hosted; these functions serve the console in read-only demo
 * mode: recorded campaigns from api-lib/seed-data.js, live cURL parsing,
 * connection tests, the live Evolus workflow status and the mock target.
 */

'use strict';

const DEMO_NOTE =
  'Static demo deployment — browsing recorded runs, cURL parsing and connection tests are live. Starting new campaigns needs the self-hosted backend (see README → Run).';

const DEMO = { readOnly: true, note: DEMO_NOTE };

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(text);
}

function methodNotAllowed(res, allow) {
  res.setHeader('Allow', allow.join(', '));
  sendJson(res, 405, { error: `Method not allowed — use ${allow.join(' or ')}` });
}

function notFound(res, what) {
  sendJson(res, 404, { error: `${what} not found` });
}

/** Read + parse a JSON body (Vercel may pre-parse it into req.body). */
async function readJsonBody(req) {
  // On Vercel `req.body` is a lazy getter and can throw (e.g. "invalid media
  // type") — never let that take the whole invocation down.
  let parsed;
  try {
    parsed = req.body;
  } catch {
    parsed = undefined;
  }
  if (parsed !== undefined) {
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
      } catch {
        return {};
      }
    }
    return parsed ?? {};
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  } catch {
    return {};
  }
}

/** Path segments after /api — e.g. /api/campaigns/abc/report.md -> ['campaigns','abc','report.md']. */
function apiSegments(req) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  return parts[0] === 'api' ? parts.slice(1) : parts;
}

function queryParam(req, key) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  return url.searchParams.get(key);
}

module.exports = {
  DEMO_NOTE,
  DEMO,
  sendJson,
  sendText,
  methodNotAllowed,
  notFound,
  readJsonBody,
  apiSegments,
  queryParam,
};
