import type { Report } from './api'
import { dateOf } from './tone'

/**
 * Self-contained HTML export of a campaign report. Rendered client-side from
 * the report JSON so it works identically on the self-hosted backend and on
 * the static Vercel demo — no extra endpoint needed. Print-friendly.
 */

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  safe: '#059669',
  none: '#059669',
  unknown: '#64748b',
}

function severityColor(severity: string): string {
  return SEVERITY_COLORS[severity.trim().toLowerCase()] ?? '#64748b'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'campaign'
  )
}

export function reportHtmlFilename(report: Report): string {
  return `evolus-red-${slugify(report.campaign.name)}.html`
}

const STAT_STYLES = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px 64px;
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a; background: #f8fafc;
  }
  .page { max-width: 900px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .12em; font-size: 12px; color: #b91c1c; text-transform: uppercase; }
  .brand .dot { width: 10px; height: 10px; border-radius: 999px; background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.18); }
  h1 { margin: 10px 0 4px; font-size: 26px; letter-spacing: -0.02em; }
  h2 { margin: 34px 0 12px; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
  h4 { margin: 0 0 4px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
  .meta { color: #475569; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
  .pill { border: 1px solid #e2e8f0; background: #fff; border-radius: 999px; padding: 2px 10px; font-size: 12px; }
  .mono, pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 22px; }
  .tile { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; }
  .tile .k { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #64748b; }
  .tile .v { margin-top: 4px; font-size: 20px; font-weight: 650; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-top: 14px; }
  dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 18px; margin: 0; }
  dl.kv dt { color: #64748b; }
  dl.kv dd { margin: 0; word-break: break-word; }
  .policy { margin: 12px 0 0; padding: 10px 12px; background: #f1f5f9; border-radius: 8px; color: #334155; }
  .finding { break-inside: avoid; }
  .finding-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .sev { color: #fff; border-radius: 999px; padding: 1px 10px; font-size: 11.5px; font-weight: 650; letter-spacing: .02em; }
  .verdict { font-size: 11.5px; border-radius: 999px; padding: 1px 10px; border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; }
  .round { margin-left: auto; color: #94a3b8; font-size: 11.5px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  @media (max-width: 720px) { .two { grid-template-columns: 1fr; } }
  pre { margin: 0; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; }
  .analysis { margin: 12px 0 0; color: #334155; }
  .next { margin: 10px 0 0; color: #64748b; font-size: 13px; }
  .counts { display: flex; flex-wrap: wrap; gap: 6px; }
  table.timeline { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.timeline th, table.timeline td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  table.timeline th { color: #64748b; font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; }
  footer { margin-top: 40px; color: #94a3b8; font-size: 11.5px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
  @media print {
    body { background: #fff; padding: 0; }
    .card, pre, table.timeline { box-shadow: none; }
    h2 { break-after: avoid; }
  }
`

export function buildReportHtml(report: Report): string {
  const c = report.campaign
  const stats = report.stats
  const h = escapeHtml

  const tiles: { k: string; v: string }[] = [
    { k: 'Total rounds', v: String(stats.totalRounds) },
    { k: 'Attack rounds', v: String(stats.attackRounds) },
    { k: 'Verdicts', v: String(stats.verdicts) },
    { k: 'Passed / failed', v: `${stats.passed} / ${stats.failed}` },
    { k: 'Worst severity', v: stats.worstSeverity },
    { k: 'Target time', v: `${(stats.totalTargetMs / 1000).toFixed(1)} s` },
  ]

  const severityCounts = Object.entries(stats.severityCounts)
    .map(
      ([sev, count]) =>
        `<span class="pill"><span style="color:${severityColor(sev)};font-weight:700">${h(sev)}</span> × ${count}</span>`,
    )
    .join('')

  const findings = report.findings
    .map((finding, i) => {
      const color = severityColor(finding.severity)
      const verdict = finding.passed === true ? 'passed' : finding.passed === false ? 'FAILED policy' : 'unknown'
      return `
      <article class="card finding">
        <div class="finding-head">
          <span class="sev" style="background:${color}">${h(finding.severity)}</span>
          <strong>#${i + 1} · ${h(finding.vulnerability_type === 'Unknown' ? 'Unspecified' : finding.vulnerability_type)}</strong>
          <span class="verdict">${verdict}</span>
          <span class="round">round ${finding.roundIdx}</span>
        </div>
        <div class="two">
          <div><h4>Probe sent</h4><pre>${h(finding.probe || '—')}</pre></div>
          <div><h4>Target reply</h4><pre>${h(finding.response || '—')}</pre></div>
        </div>
        ${finding.analysis ? `<p class="analysis">${h(finding.analysis)}</p>` : ''}
        ${
          finding.remediation_patch
            ? `<div style="margin-top:12px"><h4>Suggested remediation</h4><pre>${h(finding.remediation_patch)}</pre></div>`
            : ''
        }
        ${
          finding.next_recommended_probe
            ? `<p class="next"><strong>Next recommended probe:</strong> ${h(finding.next_recommended_probe)}</p>`
            : ''
        }
      </article>`
    })
    .join('')

  const timeline = report.timeline
    .map(
      (step) => `
        <tr>
          <td class="mono">#${step.idx}</td>
          <td>${h(step.phase)}</td>
          <td>${step.severity ? `<span class="sev" style="background:${severityColor(step.severity)}">${h(step.severity)}</span>` : '—'}</td>
          <td>${step.durationMs != null ? `${step.durationMs} ms` : '—'}</td>
          <td><div class="mono" style="max-height:72px;overflow:auto;white-space:pre-wrap">${h(step.probe.slice(0, 400))}</div></td>
        </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EVOLUS RED — ${h(c.name)}</title>
<style>${STAT_STYLES}</style>
</head>
<body>
<div class="page">
  <div class="brand"><span class="dot"></span> Evolus Red · LLM red-team report</div>
  <h1>${h(c.name)}</h1>
  <div class="meta">
    <span class="pill">${h(c.status)}</span>
    <span class="pill">${c.mode === 'deep' ? 'deep scan' : 'quick loop'}</span>
    <span class="mono" style="font-size:12px">${h(c.target.method ?? 'POST')} ${h(c.target.url ?? '')}</span>
  </div>

  <div class="tiles">
    ${tiles.map((t) => `<div class="tile"><div class="k">${t.k}</div><div class="v">${h(t.v)}</div></div>`).join('')}
  </div>

  <h2>Scope &amp; policy</h2>
  <div class="card">
    <dl class="kv">
      <dt>Created</dt><dd>${h(dateOf(c.createdAt))}</dd>
      <dt>Started</dt><dd>${h(dateOf(c.startedAt))}</dd>
      <dt>Finished</dt><dd>${h(dateOf(c.finishedAt))}</dd>
      <dt>Max rounds</dt><dd>${c.maxRounds}</dd>
      <dt>Report generated</dt><dd>${h(dateOf(report.generatedAt))}</dd>
      <dt>Severity counts</dt><dd><div class="counts">${severityCounts || '—'}</div></dd>
    </dl>
    ${c.policy ? `<p class="policy">${h(c.policy)}</p>` : ''}
  </div>

  <h2>Findings (${report.findings.length})</h2>
  ${findings || '<div class="card"><p style="margin:0;color:#64748b">No judged exchanges were recorded.</p></div>'}

  ${
    timeline
      ? `<h2>Run timeline</h2>
  <div class="card">
    <table class="timeline">
      <thead><tr><th>#</th><th>Phase</th><th>Severity</th><th>Duration</th><th>Probe</th></tr></thead>
      <tbody>${timeline}</tbody>
    </table>
  </div>`
      : ''
  }

  <footer>
    Generated by EVOLUS RED — AI red-team console for the Evolus platform. Report data exported ${h(dateOf(report.generatedAt))}.
  </footer>
</div>
</body>
</html>
`
}

export function downloadReportHtml(report: Report): void {
  const blob = new Blob([buildReportHtml(report)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = reportHtmlFilename(report)
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
