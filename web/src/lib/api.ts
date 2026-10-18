export type TargetHeader = { name: string; value: string };

export type TargetConfig = {
  url: string;
  method?: string;
  headers?: TargetHeader[];
  bodyTemplate?: string;
  responsePath?: string;
  timeoutMs?: number;
};

export type CampaignStatus = 'draft' | 'running' | 'finished' | 'stopped' | 'error';

export type Campaign = {
  id: string;
  name: string;
  mode: 'quick' | 'deep';
  status: CampaignStatus;
  policy: string;
  target: TargetConfig;
  maxRounds: number;
  recon: boolean;
  stopWhenSafe: boolean;
  authorized: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  workflowExecutionId: string | null;
  error: string | null;
  running: boolean;
  hasReport: boolean;
};

export type Verdict = {
  passed: boolean | null;
  severity: string;
  vulnerability_type: string;
  analysis: string;
  remediation_patch: string;
  next_recommended_probe: string;
};

export type Round = {
  id: number;
  idx: number;
  phase: string;
  probe: string | null;
  response: string | null;
  verdict: Verdict | null;
  status: string;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type AppEvent = {
  campaign_id: string;
  seq: number;
  ts: string;
  type: string;
  data: Record<string, unknown>;
};

export type ParsedCurl = {
  ok: boolean;
  error?: string;
  url: string;
  method: string;
  headers: TargetHeader[];
  bodyTemplate: string;
  mapped: { text?: string };
  warnings: string[];
};

export type TestResult = {
  ok: boolean;
  httpStatus?: number;
  ms?: number;
  extracted?: string;
  raw?: string;
  suggestions?: string[];
  error?: string;
};

export type Meta = {
  applicationId: string;
  agents: { key: string; label: string; id: string }[];
  workflow: { id: string; name: string; isActive: boolean | null; updatedAt?: string; error?: string };
  mock: { url: string; info: string };
};

export type ReportFinding = {
  roundIdx: number;
  severity: string;
  passed: boolean | null;
  vulnerability_type: string;
  analysis: string;
  remediation_patch: string;
  next_recommended_probe: string;
  probe: string;
  response: string;
};

export type Report = {
  campaign: {
    id: string;
    name: string;
    mode: string;
    status: string;
    policy: string;
    target: TargetConfig;
    maxRounds: number;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
  };
  generatedAt: string;
  stats: {
    totalRounds: number;
    attackRounds: number;
    verdicts: number;
    passed: number;
    failed: number;
    severityCounts: Record<string, number>;
    worstSeverity: string;
    totalTargetMs: number;
  };
  findings: ReportFinding[];
  timeline: { idx: number; phase: string; probe: string; response: string; severity: string | null; durationMs: number | null }[];
  markdown: string;
};

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

const get = <T>(path: string): Promise<T> => fetch(path).then((r) => parse<T>(r));
const post = <T>(path: string, body?: unknown): Promise<T> =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then((r) => parse<T>(r));

export const api = {
  health: () => get<{ ok: boolean; app: string; time: string }>('/api/health'),
  meta: () => get<Meta>('/api/meta'),
  listCampaigns: () => get<Campaign[]>('/api/campaigns'),
  campaign: (id: string) => get<{ campaign: Campaign; rounds: Round[] }>(`/api/campaigns/${id}`),
  createCampaign: (body: {
    name: string;
    mode: 'quick' | 'deep';
    policy: string;
    target: TargetConfig;
    maxRounds: number;
    authorized: boolean;
  }) => post<Campaign>('/api/campaigns', body),
  start: (id: string) => post<{ ok: boolean }>(`/api/campaigns/${id}/start`),
  stop: (id: string) => post<{ ok: boolean }>(`/api/campaigns/${id}/stop`),
  events: (id: string, after = 0) => get<AppEvent[]>(`/api/campaigns/${id}/events.json?after=${after}`),
  report: (id: string) => get<Report>(`/api/campaigns/${id}/report`),
  parseCurl: (curl: string) => post<ParsedCurl>('/api/parse-curl', { curl }),
  testTarget: (target: TargetConfig) => post<TestResult>('/api/targets/test', { target }),
  toggleWorkflow: (active: boolean) => post<{ ok: boolean; active: boolean }>('/api/workflow/toggle', { active }),
};

export const reportMdUrl = (id: string): string => `/api/campaigns/${id}/report.md`;
