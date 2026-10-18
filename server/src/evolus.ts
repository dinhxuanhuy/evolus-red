import { config } from './config.ts';

/**
 * Evolus platform client (server-side only).
 *  - agent chat         -> POST /v1/chat/completions  (OpenAI-compatible)
 *  - workflow control   -> REST /api/v1/workflows/...
 */

const { baseUrl, apiKey, applicationId } = config.evolus;

function authHeaders(): Record<string, string> {
  return { 'X-ApiKey': apiKey, 'X-Application-Id': applicationId };
}

export async function evolusChat(agentId: string, content: string, opts: { timeoutMs?: number; label?: string } = {}): Promise<string> {
  const { timeoutMs = 600_000, label = agentId } = opts;
  if (!agentId) throw new Error(`empty agent id (${label})`);
  const started = Date.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: `${applicationId}:${agentId}`,
          stream: false,
          messages: [{ role: 'user', content }],
        }),
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Evolus chat ${label} HTTP ${res.status}: ${text.slice(0, 400)}`);
      const json = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
      const out = json.choices?.[0]?.message?.content ?? '';
      console.log(`[evolus] ${label} ok in ${((Date.now() - started) / 1000).toFixed(1)}s (${out.length} chars)`);
      return out;
    } catch (err) {
      lastErr = err;
      console.warn(`[evolus] ${label} attempt ${attempt} failed: ${String(err).slice(0, 200)}`);
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2500));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export type WorkflowInfo = {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  updatedAt?: string;
  steps?: { order: number; name: string; stepType: number; agentId: string | null }[];
};

export async function getWorkflow(): Promise<WorkflowInfo> {
  const res = await fetch(`${baseUrl}/api/v1/workflows/${config.evolus.workflowId}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET workflow HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as WorkflowInfo;
}

export async function setWorkflowActive(active: boolean): Promise<unknown> {
  // The Evolus REST API allows only DELETE, GET, PUT on /api/v1/workflows/{id}:
  // PATCH returns 405 Method Not Allowed (errorCode common.unexpected).
  // PUT here is a PARTIAL update: omitted keys keep their current value, so
  // sending only { isActive } is enough.
  const res = await fetch(`${baseUrl}/api/v1/workflows/${config.evolus.workflowId}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ isActive: active }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT workflow HTTP ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

export async function executeWorkflow(input: string): Promise<{ executionId: string }> {
  const form = new FormData();
  form.append('input', input);
  const res = await fetch(`${baseUrl}/api/v1/workflows/${config.evolus.workflowId}/execute`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (![200, 202].includes(res.status)) {
    throw new Error(`Execute workflow HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const executionId =
    res.headers.get('x-workflow-execution-id') ??
    (text ? ((JSON.parse(text) as { executionId?: string }).executionId ?? '') : '');
  if (!executionId) throw new Error(`Execute workflow: no executionId returned (body: ${text.slice(0, 200)})`);
  return { executionId };
}

export type ExecutionDetail = {
  id: string;
  status: string;
  stepOutputs?: Record<string, string>;
  stepStates?: Record<string, { status: string; durationMs?: number }>;
  output?: string;
  error?: unknown;
  hasError?: boolean;
  completedAt?: string;
  requestedAt?: string;
  isManualTest?: boolean;
};

export async function getExecution(executionId: string): Promise<ExecutionDetail> {
  const res = await fetch(
    `${baseUrl}/api/v1/workflows/${config.evolus.workflowId}/executions/${executionId}`,
    { headers: authHeaders(), signal: AbortSignal.timeout(20_000) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`GET execution HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as ExecutionDetail;
}

export async function waitForExecution(
  executionId: string,
  onTick: (detail: ExecutionDetail) => void,
  opts: { intervalMs?: number; timeoutMs?: number; shouldStop?: () => boolean } = {},
): Promise<ExecutionDetail> {
  const { intervalMs = 15_000, timeoutMs = 2 * 60 * 60_000, shouldStop = () => false } = opts;
  const started = Date.now();
  for (;;) {
    const detail = await getExecution(executionId);
    onTick(detail);
    if (['Completed', 'Failed', 'Cancelled'].includes(detail.status)) return detail;
    if (shouldStop()) throw new Error('Stopped on request');
    if (Date.now() - started > timeoutMs) throw new Error('Workflow ran too long (timeout)');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
