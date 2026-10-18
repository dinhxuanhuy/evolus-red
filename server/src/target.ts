/**
 * Generic HTTP target adapter.
 * The target endpoint is fully dynamic: URL, method, headers, body template
 * ({{message}} raw / {{messageJson}} JSON-escaped) and response extraction.
 * {{message}} inside the URL is substituted with a URL-encoded probe (GET flows).
 */

export type TargetHeader = { name: string; value: string };

export type TargetConfig = {
  url: string;
  method?: string;
  headers?: TargetHeader[] | Record<string, string>;
  bodyTemplate?: string;
  responsePath?: string;
  session?: { captureResponseHeader?: string; sendHeader?: string };
  timeoutMs?: number;
};

export type TargetReply = {
  text: string;
  httpStatus: number;
  ms: number;
  sessionId?: string;
  /** Raw response body (truncated) — used by the connection test UI. */
  raw?: string;
};

const COMMON_KEYS = ['reply', 'response', 'message', 'content', 'answer', 'text', 'output', 'result', 'data'];

function getByPath(obj: unknown, path: string): unknown {
  const clean = path.replace(/^\$\.?/, '');
  if (!clean) return obj;
  let cur: unknown = obj;
  for (const part of clean.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function findFirstString(obj: unknown, depth = 0): string | undefined {
  if (depth > 4 || obj === null || obj === undefined) return undefined;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findFirstString(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    for (const key of COMMON_KEYS) {
      if (key in rec) {
        const found = findFirstString(rec[key], depth + 1);
        if (found) return found;
      }
    }
    for (const value of Object.values(rec)) {
      const found = findFirstString(value, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

export function extractReplyText(rawBody: string, contentType: string | null, responsePath?: string): string {
  let parsed: unknown;
  const looksJson = (contentType ?? '').includes('json') || /^\s*[{[]/.test(rawBody);
  if (looksJson) {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = undefined;
    }
  }
  if (parsed !== undefined) {
    if (responsePath) {
      const v = getByPath(parsed, responsePath);
      if (typeof v === 'string') return v;
      if (v !== undefined) return JSON.stringify(v);
    }
    const found = findFirstString(parsed);
    if (found !== undefined) return found;
  }
  return rawBody;
}

/** Dotted paths to string leaves in a JSON reply, common reply keys first. */
export function suggestReplyPaths(rawBody: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return [];
  }
  const found: { path: string; score: number }[] = [];
  const walk = (value: unknown, path: string, depth: number): void => {
    if (found.length > 40 || depth > 5) return;
    if (typeof value === 'string') {
      const key = (path.split('.').pop() ?? '').toLowerCase();
      const common = COMMON_KEYS.findIndex((k) => k.toLowerCase() === key);
      found.push({ path, score: common >= 0 ? common : 100 + path.length });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), depth + 1));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }
  };
  walk(parsed, '', 0);
  return found
    .sort((a, b) => a.score - b.score)
    .slice(0, 8)
    .map((entry) => entry.path);
}

function renderTemplate(text: string, message: string, urlMode = false): string {
  const jsonSafe = JSON.stringify(message);
  return text
    .replaceAll('{{messageJson}}', urlMode ? encodeURIComponent(jsonSafe) : jsonSafe)
    .replaceAll('{{message}}', urlMode ? encodeURIComponent(message) : message.replaceAll('"', '\\"'));
}

export class TargetClient {
  private sessionId?: string;
  private cfg: TargetConfig;
  constructor(cfg: TargetConfig) {
    this.cfg = cfg;
  }

  async send(message: string): Promise<TargetReply> {
    const { url, method = 'POST', headers = [], bodyTemplate, responsePath, session, timeoutMs = 45_000 } = this.cfg;
    if (!url) throw new Error('Target has no URL');

    const started = Date.now();
    const finalHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    // Case-insensitive merge: a curl almost always brings its own content-type,
    // and a duplicate header would be joined by fetch into an invalid media type.
    const setHeader = (name: string, value: string): void => {
      for (const key of Object.keys(finalHeaders)) {
        if (key.toLowerCase() === name.toLowerCase()) delete finalHeaders[key];
      }
      finalHeaders[name] = value;
    };
    if (Array.isArray(headers)) {
      for (const h of headers) if (h?.name) setHeader(h.name, String(h.value ?? ''));
    } else if (headers && typeof headers === 'object') {
      for (const [name, value] of Object.entries(headers)) setHeader(name, String(value ?? ''));
    }
    if (session?.sendHeader && this.sessionId) setHeader(session.sendHeader, this.sessionId);

    const template = bodyTemplate?.trim() || '{"message": {{messageJson}}}';
    const body = renderTemplate(template, message);
    const finalUrl = renderTemplate(url, message, true);

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(finalUrl, {
        method,
        headers: finalHeaders,
        body: ['GET', 'HEAD'].includes(method.toUpperCase()) ? undefined : body,
        signal: ctl.signal,
        redirect: 'follow',
      });
      const rawBody = await res.text();
      const text = extractReplyText(rawBody, res.headers.get('content-type'), responsePath);
      if (session?.captureResponseHeader) {
        const captured = res.headers.get(session.captureResponseHeader);
        if (captured) this.sessionId = captured;
      }
      return {
        text,
        httpStatus: res.status,
        ms: Date.now() - started,
        sessionId: this.sessionId,
        raw: rawBody.slice(0, 4000),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
