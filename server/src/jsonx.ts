/**
 * Robust JSON extraction from LLM output.
 * Agents often emit reasoning text before/after the JSON payload, wrap it in
 * markdown fences, or add stray tokens. Strategy:
 *  1. direct parse (after fence stripping)
 *  2. scan every balanced {...} block and keep the last parseable object
 *  3. regex field extraction fallback for known verdict fields
 */

export function stripFences(text: string): string {
  return text
    .replace(/```jsonc?/gi, '```')
    .replace(/```/g, '')
    .trim();
}

function tryParse(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function extractJson<T = unknown>(raw: string): T | undefined {
  if (!raw) return undefined;
  const text = stripFences(raw);

  const direct = tryParse(text);
  if (direct !== undefined) return direct as T;

  // scan balanced brace blocks
  const candidates: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          candidates.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i--) {
    const parsed = tryParse(candidates[i]);
    if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
      return parsed as T;
    }
  }
  return undefined;
}

export type Verdict = {
  passed: boolean | null;
  severity: string;
  vulnerability_type: string;
  analysis: string;
  remediation_patch: string;
  next_recommended_probe: string;
  raw: string;
};

function fieldFromText(text: string, field: string): string {
  // tolerate "field": "value" and 'field': value with escaped quotes
  const re = new RegExp(`["']?${field}["']?\\s*[:=]\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'is');
  const m = re.exec(text);
  if (m) return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
  const re2 = new RegExp(`["']?${field}["']?\\s*[:=]\\s*([^,\\n}]+)`, 'is');
  const m2 = re2.exec(text);
  return m2 ? m2[1].trim().replace(/^["']|["']$/g, '') : '';
}

export function extractVerdict(raw: string): Verdict {
  const obj = extractJson<Record<string, unknown>>(raw);
  const get = (k: string): string => {
    const v = obj?.[k];
    if (typeof v === 'string') return v;
    if (v !== undefined && v !== null && typeof v !== 'object') return String(v);
    return '';
  };
  const passedRaw = obj?.['passed'];
  let passed: boolean | null = null;
  if (typeof passedRaw === 'boolean') passed = passedRaw;
  else if (typeof passedRaw === 'string') passed = /true|pass(ed)?|safe/i.test(passedRaw);

  const getAny = (...keys: string[]): string => {
    for (const k of keys) {
      const v = get(k);
      if (v) return v;
    }
    return '';
  };
  const severity =
    getAny('severity', 'severity_level', 'severityLevel', 'level', 'risk') ||
    fieldFromText(raw, 'severity') ||
    (passed === true ? 'Safe' : 'Unknown');
  return {
    passed,
    severity: severity || 'Unknown',
    vulnerability_type:
      getAny('vulnerability_type', 'vulnerabilityType', 'vulnerability', 'vulnerability_class', 'vulnerabilityClass', 'category', 'type') ||
      fieldFromText(raw, 'vulnerability_type') ||
      fieldFromText(raw, 'vulnerability') ||
      'Unknown',
    analysis: get('analysis') || fieldFromText(raw, 'analysis'),
    remediation_patch: get('remediation_patch') || fieldFromText(raw, 'remediation_patch'),
    next_recommended_probe:
      get('next_recommended_probe') || fieldFromText(raw, 'next_recommended_probe'),
    raw,
  };
}

/** sanitize stray glitch tokens / excessive whitespace for display */
export function sanitize(text: string): string {
  if (!text) return '';
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
