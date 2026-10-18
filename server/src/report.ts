import type { CampaignRow, RoundRow } from './db.ts';
import { sanitize } from './jsonx.ts';
import type { TargetConfig } from './target.ts';

export const SEVERITY_ORDER = ['Safe', 'Low', 'Medium', 'High', 'Critical'] as const;

export type Finding = {
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
  reconProfile: string;
  planOutput: string;
  findings: Finding[];
  timeline: {
    idx: number;
    phase: string;
    probe: string;
    response: string;
    severity: string | null;
    durationMs: number | null;
  }[];
  markdown: string;
};

function sevIndex(s: string): number {
  const i = SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number]);
  return i === -1 ? -1 : i;
}

export function buildReport(campaign: CampaignRow, rounds: RoundRow[]): Report {
  const findings: Finding[] = [];
  const severityCounts: Record<string, number> = {};
  let passed = 0;
  let failed = 0;
  let totalTargetMs = 0;

  for (const r of rounds) {
    if (r.duration_ms) totalTargetMs += r.duration_ms;
    if (!r.verdict_json) continue;
    let verdict: Record<string, unknown>;
    try {
      verdict = JSON.parse(r.verdict_json) as Record<string, unknown>;
    } catch {
      continue;
    }
    const severity = String(verdict.severity ?? 'Unknown');
    severityCounts[severity] = (severityCounts[severity] ?? 0) + 1;
    if (verdict.passed === true) passed += 1;
    else failed += 1;
    findings.push({
      roundIdx: r.idx,
      severity,
      passed: (verdict.passed as boolean | null) ?? null,
      vulnerability_type: String(verdict.vulnerability_type ?? 'Unknown'),
      analysis: sanitize(String(verdict.analysis ?? '')),
      remediation_patch: sanitize(String(verdict.remediation_patch ?? '')),
      next_recommended_probe: sanitize(String(verdict.next_recommended_probe ?? '')),
      probe: sanitize(r.probe ?? ''),
      response: sanitize(r.response ?? ''),
    });
  }

  const worst = Object.keys(severityCounts).sort((a, b) => sevIndex(b) - sevIndex(a))[0] ?? 'Unknown';

  let reconProfile = '';
  let planOutput = '';
  for (const r of rounds) {
    const phase = r.phase ?? '';
    if (!reconProfile && phase.startsWith('deep:recon')) reconProfile = sanitize(r.response ?? '');
    if (!planOutput && phase.startsWith('deep:planner')) planOutput = sanitize(r.response ?? '');
  }

  const report: Report = {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      mode: campaign.mode,
      status: campaign.status,
      policy: campaign.policy,
      target: JSON.parse(campaign.target_json ?? '{}') as TargetConfig,
      maxRounds: campaign.max_rounds,
      createdAt: campaign.created_at,
      startedAt: campaign.started_at,
      finishedAt: campaign.finished_at,
    },
    generatedAt: new Date().toISOString(),
    stats: {
      totalRounds: rounds.length,
      attackRounds: rounds.filter((r) => r.phase === 'attack').length,
      verdicts: findings.length,
      passed,
      failed,
      severityCounts,
      worstSeverity: worst,
      totalTargetMs,
    },
    reconProfile,
    planOutput,
    findings,
    timeline: rounds.map((r) => ({
      idx: r.idx,
      phase: r.phase,
      probe: sanitize(r.probe ?? ''),
      response: sanitize(r.response ?? ''),
      severity: r.verdict_json ? (JSON.parse(r.verdict_json).severity ?? null) : null,
      durationMs: r.duration_ms,
    })),
    markdown: '',
  };

  report.markdown = renderMarkdown(report);
  return report;
}

function renderMarkdown(report: Report): string {
  const c = report.campaign;
  const s = report.stats;
  const lines: string[] = [];
  lines.push(`# Red-Team Report — ${c.name}`);
  lines.push('');
  lines.push(`- **Target:** \`${c.target.url}\` (${c.target.method ?? 'POST'})`);
  lines.push(`- **Mode:** ${c.mode === 'deep' ? 'Deep scan (AttackLoop workflow)' : 'Quick loop'}`);
  lines.push(`- **Started:** ${c.startedAt ?? '—'} · **Finished:** ${c.finishedAt ?? '—'}`);
  lines.push(`- **Security policy:** ${c.policy}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Total rounds | ${s.totalRounds} |`);
  lines.push(`| Verdicts | ${s.verdicts} (passed: ${s.passed}, failed: ${s.failed}) |`);
  lines.push(`| Highest severity | **${s.worstSeverity}** |`);
  for (const sev of SEVERITY_ORDER) {
    if (s.severityCounts[sev]) lines.push(`| ${sev} | ${s.severityCounts[sev]} |`);
  }
  lines.push('');
  if (report.reconProfile) {
    lines.push('## Target profile (Recon)');
    lines.push('');
    lines.push(report.reconProfile);
    lines.push('');
  }
  if (report.planOutput) {
    lines.push('## Attack plan (Planner)');
    lines.push('');
    lines.push(report.planOutput);
    lines.push('');
  }
  lines.push('## Findings');
  lines.push('');
  if (report.findings.length === 0) {
    lines.push('_No verdicts were recorded._');
  }
  report.findings.forEach((f, i) => {
    lines.push(`### ${i + 1}. [${f.severity}] ${f.vulnerability_type === 'Unknown' ? 'Unspecified' : f.vulnerability_type}`);
    lines.push('');
    lines.push(`- **Result:** ${f.passed === true ? 'PASSED' : f.passed === false ? 'FAILED (policy violation)' : 'Unknown'}`);
    lines.push('');
    lines.push('**Probe:**');
    lines.push('> ' + f.probe.replace(/\n/g, '\n> '));
    lines.push('');
    lines.push('**Target response:**');
    lines.push('> ' + f.response.replace(/\n/g, '\n> '));
    lines.push('');
    if (f.analysis) {
      lines.push('**Analysis:**');
      lines.push(f.analysis);
      lines.push('');
    }
    if (f.remediation_patch) {
      lines.push('**Suggested remediation:**');
      lines.push('```');
      lines.push(f.remediation_patch);
      lines.push('```');
      lines.push('');
    }
    if (f.next_recommended_probe) {
      lines.push('**Next recommended probe:**');
      lines.push('> ' + f.next_recommended_probe.replace(/\n/g, '\n> '));
      lines.push('');
    }
  });
  lines.push('---');
  lines.push(`_Generated by EVOLUS RED at ${report.generatedAt}_`);
  return lines.join('\n');
}
