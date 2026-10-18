/**
 * Parse a `Copy as cURL` command (DevTools → Copy as cURL) into our target
 * config: URL, method, headers and a body template with a message placeholder.
 *
 * Adapted from the AI_RedTeam parser: shell tokenizer (quotes, `\` and `$'…'`
 * continuations) → option walk → template mapping. The message field is mapped
 * to `{{messageJson}}` (JSON-safe) or `{{message}}` (raw / query) — the two
 * placeholders TargetClient substitutes at send time.
 */

export type CurlHeader = { name: string; value: string };

export type ParsedCurl = {
  ok: boolean;
  error?: string;
  url: string;
  method: string;
  headers: CurlHeader[];
  bodyTemplate: string;
  /** Which body/query key was mapped to the message placeholder. */
  mapped: { text?: string };
  warnings: string[];
};

const TEXT_KEYS = /^(message|prompt|query|q|text|input|content|question|utterance|user_?input|user_?message)$/i;
const SESSION_KEYS = /^(sid|session|session_?id|conversation_?id|thread_?id|chat_?id)$/i;
const CREDENTIAL_HEADER = /^(authorization|cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-access-token)$/i;

const MSG_SENTINEL = '__EVOLUS_MESSAGE__';

/** Split a shell-ish command line into tokens; quotes are stripped, escapes honoured. */
export function tokenizeCurl(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, ' ');
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? '';
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      if (ch === '\\' && i + 1 < text.length) {
        const next = text[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          current += next;
          i++;
        } else if (next === 'n') {
          current += '\n';
          i++;
        } else {
          current += ch;
        }
        continue;
      }
      if (ch === '"') quote = null;
      else current += ch;
      continue;
    }
    // ANSI-C quoting ($'…') — used by Chrome "Copy as cURL" for bodies with newlines/tabs.
    if (ch === '$' && text[i + 1] === "'") {
      i += 2;
      started = true;
      while (i < text.length) {
        const c = text[i] ?? '';
        if (c === '\\' && i + 1 < text.length) {
          const n = text[i + 1];
          if (n === 'n') current += '\n';
          else if (n === 't') current += '\t';
          else if (n === 'r') current += '\r';
          else current += n ?? '';
          i += 2;
          continue;
        }
        if (c === "'") break;
        current += c;
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started || current) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      current += text[i + 1];
      i++;
      started = true;
      continue;
    }
    current += ch;
    started = true;
  }
  if (started || current) tokens.push(current);
  return tokens;
}

function formPairs(body: string): Record<string, string> | null {
  if (!body.includes('=')) return null;
  const pairs: Record<string, string> = {};
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return null;
    const key = decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' '));
    const value = decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '));
    pairs[key] = value;
  }
  return Object.keys(pairs).length > 0 ? pairs : null;
}

type Leaf = { path: (string | number)[]; key: string; value: string; inUserMessage: boolean };

function collectLeaves(value: unknown, path: (string | number)[], inUserMessage: boolean, out: Leaf[]): void {
  if (out.length > 300) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectLeaves(item, [...path, index], inUserMessage, out));
    return;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const isUser = inUserMessage || String(record.role ?? '').toLowerCase() === 'user';
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === 'string') out.push({ path: [...path, key], key, value: child, inUserMessage: isUser });
      else collectLeaves(child, [...path, key], isUser, out);
    }
  }
}

function setAt(root: Record<string, unknown>, path: (string | number)[], value: unknown): void {
  let current: unknown = root;
  for (const part of path.slice(0, -1)) {
    if (current === null || typeof current !== 'object') return;
    current = (current as Record<string | number, unknown>)[part];
  }
  if (current !== null && typeof current === 'object') {
    const record = current as Record<string | number, unknown>;
    const last = path[path.length - 1];
    if (last !== undefined) record[last] = value;
  }
}

type Mapping = { template: Record<string, unknown>; mapped: { text?: string }; warnings: string[] };

/**
 * Map a JSON body: the most chat-like string field becomes the placeholder.
 * Preference: last `content` inside a `role:"user"` message, then any field
 * with a familiar name (message/prompt/question/…), then the longest string.
 */
function mapJsonBody(source: Record<string, unknown>): Mapping {
  const template = JSON.parse(JSON.stringify(source)) as Record<string, unknown>;
  const warnings: string[] = [];
  const mapped: { text?: string } = {};

  const leaves = [] as Leaf[];
  collectLeaves(source, [], false, leaves);

  const textCandidates = leaves.filter((leaf) => TEXT_KEYS.test(leaf.key) && !SESSION_KEYS.test(leaf.key));
  const userCandidates = textCandidates.filter((leaf) => leaf.inUserMessage);
  let textLeaf = userCandidates[userCandidates.length - 1] ?? textCandidates[textCandidates.length - 1];

  if (!textLeaf) {
    const longest = leaves
      .filter((leaf) => !SESSION_KEYS.test(leaf.key))
      .sort((a, b) => b.value.length - a.value.length)[0];
    if (longest) {
      textLeaf = longest;
      warnings.push(`no message-like field name found — using the longest string ("${longest.key}") as the probe slot`);
    }
  }

  if (textLeaf) {
    setAt(template, textLeaf.path, MSG_SENTINEL);
    mapped.text = textLeaf.key;
  } else {
    warnings.push('no string field in the body — using the default template {"message": {{messageJson}}}');
    return { template: { message: MSG_SENTINEL }, mapped, warnings };
  }
  return { template, mapped, warnings };
}

function renderJsonTemplate(template: Record<string, unknown>): string {
  const json = JSON.stringify(template, null, 2);
  return json.replace(`"${MSG_SENTINEL}"`, '{{messageJson}}');
}

export function parseCurl(input: string): ParsedCurl {
  const warnings: string[] = [];
  const headers: CurlHeader[] = [];
  const data: string[] = [];
  let credentialHeaders: string[] = [];
  let url: string | null = null;
  let methodVerb: string | null = null;
  let formBody = false;

  const tokens = tokenizeCurl(input);
  if (tokens.length === 0) {
    return { ok: false, error: 'the curl command is empty', url: '', method: 'POST', headers, bodyTemplate: '', mapped: {}, warnings };
  }
  if (!/(^|\/)curl(\.exe)?$/i.test(tokens[0] ?? '')) {
    warnings.push('command does not start with `curl` — parsing the remaining tokens anyway');
  }

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const next = (): string => tokens[++i] ?? '';
    switch (token) {
      case '-X':
      case '--request':
        methodVerb = next().toUpperCase();
        break;
      case '-H':
      case '--header': {
        const raw = next();
        const colon = raw.indexOf(':');
        if (colon <= 0) {
          warnings.push(`invalid header skipped: "${raw.slice(0, 40)}"`);
          break;
        }
        const name = raw.slice(0, colon).trim();
        const value = raw.slice(colon + 1).trim();
        headers.push({ name, value });
        if (CREDENTIAL_HEADER.test(name)) credentialHeaders.push(name);
        break;
      }
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--json':
        data.push(next());
        break;
      case '--data-urlencode':
        data.push(next());
        formBody = true;
        break;
      case '--url':
        url = next();
        break;
      case '-b':
      case '--cookie':
        credentialHeaders.push('Cookie');
        next();
        break;
      case '-u':
      case '--user':
        credentialHeaders.push('Authorization (basic auth)');
        next();
        break;
      case '-F':
      case '--form':
        warnings.push('multipart form (-F) is not supported — paste a JSON or form-urlencoded request');
        next();
        break;
      case '-A':
      case '--user-agent':
      case '-e':
      case '--referer':
      case '-o':
      case '--output':
      case '--connect-timeout':
      case '--max-time':
      case '--retry':
      case '--resolve':
      case '-x':
      case '--proxy':
        next();
        break;
      case '--compressed':
      case '-k':
      case '--insecure':
      case '-s':
      case '--silent':
      case '-S':
      case '--show-error':
      case '-L':
      case '--location':
      case '-i':
      case '--include':
      case '-v':
      case '--verbose':
      case '-#':
      case '--progress-bar':
      case '-g':
      case '--globoff':
        break;
      default:
        if (token.startsWith('-')) {
          warnings.push(`unsupported flag ignored: ${token}`);
        } else if (url === null) {
          url = token;
        } else {
          warnings.push(`extra token ignored: ${token.slice(0, 40)}`);
        }
    }
  }

  if (url === null) {
    return { ok: false, error: 'no URL found in the curl command', url: '', method: 'POST', headers, bodyTemplate: '', mapped: {}, warnings };
  }
  if (!/^https?:\/\//i.test(url)) {
    warnings.push('URL does not start with http(s):// — double-check before running');
  }

  const verb = methodVerb ?? (data.length > 0 || formBody ? 'POST' : 'GET');
  const method = verb || 'POST';
  if (!['POST', 'GET'].includes(method)) warnings.push(`method ${method} is unusual for chat endpoints — keeping it anyway`);

  const contentType = headers.find((h) => h.name.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
  const joined = data.join('&');

  // ---------- GET: query string carries the probe ----------
  if (method === 'GET') {
    let templateUrl = url;
    const mapped: { text?: string } = {};
    if (!/^https?:\/\//i.test(url)) {
      return { ok: true, url, method, headers, bodyTemplate: '', mapped, warnings };
    }
    const qIndex = url.indexOf('?');
    if (qIndex >= 0) {
      const base = url.slice(0, qIndex);
      const pairs = url.slice(qIndex + 1).split('&').filter(Boolean);
      const keyOf = (pair: string): string => {
        const eq = pair.indexOf('=');
        const rawKey = eq >= 0 ? pair.slice(0, eq) : pair;
        try {
          return decodeURIComponent(rawKey.replace(/\+/g, ' '));
        } catch {
          return rawKey;
        }
      };
      let target = pairs.findIndex((pair) => TEXT_KEYS.test(keyOf(pair)));
      if (target === -1 && pairs.length > 0) target = 0;
      if (target >= 0) {
        mapped.text = keyOf(pairs[target] ?? '');
        pairs[target] = `${pairs[target]!.split('=')[0] ?? ''}={{message}}`;
        templateUrl = `${base}?${pairs.join('&')}`;
      }
    } else {
      warnings.push('GET with no query params — the probe will be appended as ?q={{message}}');
      templateUrl = `${url}?q={{message}}`;
      mapped.text = 'q';
    }
    return { ok: true, url: templateUrl, method, headers, bodyTemplate: '', mapped, warnings };
  }

  // ---------- POST: body carries the probe ----------
  let source: Record<string, unknown> | null = null;
  if (joined) {
    if (contentType.includes('urlencoded') || (formBody && !joined.trimStart().startsWith('{'))) {
      source = formPairs(joined);
    }
    if (source === null) {
      try {
        const parsed: unknown = JSON.parse(joined);
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          source = parsed as Record<string, unknown>;
        } else {
          warnings.push('body JSON is not an object — edit the template manually');
        }
      } catch {
        source = formPairs(joined);
        if (!source) {
          warnings.push('body is neither JSON nor form-urlencoded — default template {"message": {{messageJson}}} used');
          source = null;
        }
      }
    }
  } else {
    warnings.push('curl has no body — default template {"message": {{messageJson}}} used');
  }

  // urlencoded bodies keep their literal text form with a raw placeholder
  if (source && joined && !joined.trimStart().startsWith('{')) {
    const pairs = source;
    const textKey = Object.keys(pairs).find((k) => TEXT_KEYS.test(k)) ?? Object.keys(pairs)[0];
    const mappedText = textKey && pairs[textKey] !== undefined ? textKey : undefined;
    if (mappedText) pairs[mappedText] = '{{message}}';
    const template = Object.entries(pairs)
      .map(([k, v]) => `${encodeURIComponent(k)}=${v}`)
      .join('&');
    if (mappedText) warnings.push('probe is inserted raw into the form body — verify the endpoint accepts it');
    return { ok: true, url, method, headers, bodyTemplate: template, mapped: { text: mappedText }, warnings };
  }

  const mapping = mapJsonBody(source ?? { message: MSG_SENTINEL });
  warnings.push(...mapping.warnings);

  if (credentialHeaders.length > 0) {
    warnings.push(
      `credential header(s) parsed: ${credentialHeaders.join(', ')} — stored in the campaign record on this machine only`,
    );
  }

  return {
    ok: true,
    url,
    method,
    headers,
    bodyTemplate: renderJsonTemplate(mapping.template),
    mapped: mapping.mapped,
    warnings,
  };
}
