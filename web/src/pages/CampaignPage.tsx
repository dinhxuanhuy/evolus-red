import {
  Brain,
  Download,
  FileJson,
  Play,
  Scale,
  ScanSearch,
  Square,
  Swords,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { API_BASE, api, type AppEvent, type Campaign, type Report, type Round } from '../lib/api'
import { downloadReportHtml } from '../lib/reportHtml'
import { dateOf, eventMeta, severityTone, statusMeta, timeOf, type Tone } from '../lib/tone'
import {
  Badge,
  Button,
  EmptyState,
  KeyValue,
  Mono,
  Panel,
  PanelBody,
  PanelHeader,
  StatusDot,
  Tabs,
  ToneBadge,
  cn,
} from '../components/ui'

type TabValue = 'live' | 'rounds' | 'report'

function truncate(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

/* --------------------------- AttackLoop phase board -------------------------- */

const DEEP_PHASES: { name: string; role: string }[] = [
  { name: 'Recon', role: 'Probes the target and builds a behavioral profile' },
  { name: 'Planner', role: 'Turns the recon profile into attack hypotheses' },
  { name: 'Attacker', role: 'Crafts and sends the probe payloads' },
  { name: 'Judge', role: 'Scores every reply against the Security Policy' },
]

const PHASE_ICONS: Record<string, LucideIcon> = {
  Recon: ScanSearch,
  Planner: Brain,
  Attacker: Swords,
  Judge: Scale,
}

type PhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'unknown'

type PhaseState = {
  order: number
  name: string
  role: string
  status: PhaseStatus
  durationMs: number | null
  output: string | null
  verdict: { severity: string; passed: boolean | null } | null
}

function normalizePhaseStatus(raw: unknown): PhaseStatus {
  const s = String(raw ?? '').toLowerCase()
  if (!s || ['pending', 'queued', 'waiting'].includes(s)) return 'pending'
  if (['running', 'executing', 'active', 'in_progress'].includes(s) || s.includes('run') || s.includes('progress')) {
    return 'running'
  }
  if (s.includes('complet') || s.includes('success') || s === 'done') return 'completed'
  if (s.includes('fail') || s.includes('error') || s.includes('cancel')) return 'failed'
  return 'unknown'
}

const phaseStatusWord = (raw: unknown): string => {
  const s = normalizePhaseStatus(raw)
  return s === 'completed' ? 'done' : s
}

/**
 * Rebuilds the four AttackLoop phases from the event stream (live SSE or the
 * recorded demo replay) and the stored rounds — rounds are the source of truth
 * for outputs/verdicts, events carry the live status board.
 */
function derivePhases(events: AppEvent[], rounds: Round[]): PhaseState[] | null {
  const phases: PhaseState[] = DEEP_PHASES.map((p, i) => ({
    order: i + 1,
    name: p.name,
    role: p.role,
    status: 'pending',
    durationMs: null,
    output: null,
    verdict: null,
  }))
  let seen = false
  const byOrder = (raw: unknown): PhaseState | undefined => {
    const order = Number(raw)
    return Number.isInteger(order) ? phases.find((p) => p.order === order) : undefined
  }

  for (const ev of events) {
    if (ev.type.startsWith('deep.')) seen = true
    if (ev.type === 'deep.progress') {
      const steps = Array.isArray(ev.data.steps) ? (ev.data.steps as Record<string, unknown>[]) : null
      const states = steps
        ? steps.map((s) => [s.order, s] as const)
        : Object.entries((ev.data.stepStates ?? {}) as Record<string, Record<string, unknown>>)
      for (const [key, raw] of states) {
        const p = byOrder(key)
        if (!p || p.output) continue
        p.status = normalizePhaseStatus(raw?.status)
        const d = Number(raw?.durationMs)
        if (raw?.durationMs != null && Number.isFinite(d)) p.durationMs = d
      }
    } else if (ev.type === 'deep.step') {
      const p = byOrder(ev.data.order) ?? phases.find((x) => x.name.toLowerCase() === String(ev.data.name ?? '').toLowerCase())
      if (!p) continue
      if (ev.data.output) p.output = String(ev.data.output)
      const d = Number(ev.data.durationMs)
      if (ev.data.durationMs != null && Number.isFinite(d)) p.durationMs = d
      if (p.status !== 'failed') p.status = 'completed'
    }
  }

  for (const r of rounds) {
    if (!r.phase.startsWith('deep:')) continue
    seen = true
    const p = phases.find((x) => x.name.toLowerCase() === r.phase.slice(5).trim())
    if (!p) continue
    if (r.response) p.output = r.response
    if (r.durationMs != null) p.durationMs = r.durationMs
    if (r.verdict) p.verdict = { severity: r.verdict.severity, passed: r.verdict.passed }
    if (p.status === 'pending' || p.status === 'running') p.status = 'completed'
  }

  return seen ? phases : null
}

function eventDetail(ev: AppEvent): { text: string; level?: string } {
  const d = (ev.data ?? {}) as Record<string, unknown>
  switch (ev.type) {
    case 'log':
      return { text: String(d.message ?? ''), level: String(d.level ?? 'info') }
    case 'phase':
      return { text: `▶ ${String(d.label ?? d.phase ?? '')}` }
    case 'recon.probe':
      return { text: `probe #${d.idx}: ${String(d.probe ?? '')}` }
    case 'recon.response':
    case 'round.response':
      return { text: `reply (${d.httpStatus} · ${d.ms}ms): ${truncate(String(d.response ?? ''))}` }
    case 'round.probe':
      return { text: `probe #${d.idx} → ${String(d.probe ?? '')}` }
    case 'recon.profile':
      return { text: truncate(String(d.profile ?? ''), 400) }
    case 'round.verdict': {
      const v = (d.verdict ?? {}) as Record<string, unknown>
      return {
        text: `[${String(v.severity ?? '?')}] ${String(v.vulnerability_type ?? '')} — ${
          v.passed === true ? 'passed' : 'FAILED policy'
        }`,
      }
    }
    case 'report': {
      const r = d.report as Report | undefined
      return {
        text: `report ready — ${r?.stats.verdicts ?? '?'} verdicts, worst severity ${r?.stats.worstSeverity ?? '?'}`,
      }
    }
    case 'done':
      return { text: `campaign done (status: ${String(d.status ?? 'finished')})` }
    case 'error':
      return { text: String(d.message ?? 'error'), level: 'error' }
    case 'status':
      return { text: `status: ${String(d.status ?? '')}` }
    case 'deep.execution':
      return { text: `workflow execution ${String(d.executionId ?? '')}` }
    case 'deep.progress': {
      const steps = Array.isArray(d.steps) ? (d.steps as Record<string, unknown>[]) : []
      if (steps.length > 0) {
        const board = steps
          .map((s) => {
            const ms = s.durationMs == null ? NaN : Number(s.durationMs)
            return `${String(s.name ?? '?')}: ${phaseStatusWord(s.status)}${Number.isFinite(ms) ? ` ${(ms / 1000).toFixed(1)}s` : ''}`
          })
          .join(' · ')
        return { text: `workflow status=${String(d.status ?? '')} — ${board}` }
      }
      return { text: `workflow status=${String(d.status ?? '')}` }
    }
    case 'deep.step': {
      const ms = d.durationMs == null ? NaN : Number(d.durationMs)
      const verdictSummary = (d.verdict ?? null) as { severity?: unknown } | null
      const sev = verdictSummary?.severity ? ` [${String(verdictSummary.severity)}]` : ''
      return {
        text: `phase ${String(d.order)} · ${String(d.name)}${sev} (${Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : '?'}): ${truncate(String(d.output ?? ''))}`,
      }
    }
    default:
      return { text: JSON.stringify(ev.data).slice(0, 200) }
  }
}

export default function CampaignPage() {
  const { id = '' } = useParams()
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [rounds, setRounds] = useState<Round[]>([])
  const [events, setEvents] = useState<AppEvent[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [tab, setTab] = useState<TabValue>('live')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'start' | 'stop' | null>(null)
  /** Vercel static deployment: recorded data only — hide run controls and SSE. */
  const [demo, setDemo] = useState(false)

  useEffect(() => {
    api
      .meta()
      .then((m) => setDemo(!!m.demo?.readOnly))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [detail, evs] = await Promise.all([api.campaign(id), api.events(id)])
      setCampaign(detail.campaign)
      setRounds(detail.rounds)
      setEvents((prev) => {
        const merged = new Map<number, AppEvent>()
        for (const ev of [...prev, ...evs]) merged.set(ev.seq, ev)
        return [...merged.values()].sort((a, b) => a.seq - b.seq)
      })
      setLoadError(null)
      if (detail.campaign.hasReport) {
        setReport(await api.report(id).catch(() => null))
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!id || demo) return
    const es = new EventSource(`${API_BASE}/api/campaigns/${id}/events`)
    es.onmessage = (message) => {
      try {
        const ev = JSON.parse(message.data) as AppEvent
        setEvents((prev) => (prev.some((p) => p.seq === ev.seq) ? prev : [...prev, ev].sort((a, b) => a.seq - b.seq)))
        if (ev.type === 'done' || ev.type === 'error' || ev.type === 'report') void load()
      } catch {
        /* ignore malformed frames */
      }
    }
    return () => es.close()
  }, [id, load, demo])

  /** The four AttackLoop phases (null when this campaign never ran a deep scan). */
  const phases = useMemo(() => derivePhases(events, rounds), [events, rounds])

  const start = async () => {
    setBusy('start')
    setActionError(null)
    try {
      await api.start(id)
      setReport(null)
      setEvents([])
      await load()
      setTab('live')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const stop = async () => {
    setBusy('stop')
    setActionError(null)
    try {
      await api.stop(id)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  if (loadError) {
    return (
      <Panel>
        <PanelBody className="p-4">
          <p className="text-xs text-critical">Could not load the campaign: {loadError}</p>
          <Button className="mt-2" onClick={() => void load()}>
            Retry
          </Button>
        </PanelBody>
      </Panel>
    )
  }

  if (!campaign) {
    return <p className="text-xs text-fg-subtle">Loading campaign…</p>
  }

  const running = campaign.running && !demo

  return (
    <div className="space-y-4">
      <Panel>
        <PanelBody className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-fg">{campaign.name}</h1>
                <ToneBadge tone={statusMeta[campaign.status].tone} label={statusMeta[campaign.status].label} />
                <Badge variant={campaign.mode === 'deep' ? 'intel' : 'outline'}>
                  {campaign.mode === 'deep' ? 'deep scan' : 'quick loop'}
                </Badge>
                {running ? <StatusDot tone="brand" pulse /> : null}
              </div>
              <p className="mt-1.5 font-mono text-[11px] break-all text-fg-subtle">
                {campaign.target.method ?? 'POST'} {campaign.target.url}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {demo ? (
                <ToneBadge tone="muted" label="read-only demo" />
              ) : !running ? (
                <Button variant="primary" loading={busy === 'start'} onClick={() => void start()}>
                  <Play aria-hidden /> {campaign.hasReport || campaign.status !== 'draft' ? 'Re-run scan' : 'Start scan'}
                </Button>
              ) : (
                <Button variant="warn" loading={busy === 'stop'} onClick={() => void stop()}>
                  <Square aria-hidden /> Stop
                </Button>
              )}
              {campaign.hasReport ? (
                <>
                  <Button disabled={!report} onClick={() => report && downloadReportHtml(report)}>
                    <Download aria-hidden /> report.html
                  </Button>
                  <a href={`/api/campaigns/${campaign.id}/report`} target="_blank" rel="noreferrer">
                    <Button>
                      <FileJson aria-hidden /> JSON
                    </Button>
                  </a>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-3 grid gap-x-8 gap-y-1 border-t border-line pt-2 sm:grid-cols-2">
            <KeyValue k="Created" v={dateOf(campaign.createdAt)} mono={false} />
            <KeyValue k="Started" v={dateOf(campaign.startedAt)} mono={false} />
            <KeyValue k="Finished" v={dateOf(campaign.finishedAt)} mono={false} />
            <KeyValue k="Max rounds" v={String(campaign.maxRounds)} />
            {campaign.workflowExecutionId ? (
              <KeyValue k="Workflow execution" v={campaign.workflowExecutionId} />
            ) : null}
          </div>

          <p className="mt-2 border-t border-line pt-2 text-[11px] leading-relaxed text-fg-faint">
            <span className="ink-label mr-1">Policy</span> {campaign.policy}
          </p>

          {campaign.error ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-sm border border-critical/35 bg-critical/10 px-2 py-1.5 text-[11px] text-critical">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {campaign.error}
            </p>
          ) : null}
          {actionError ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-sm border border-critical/35 bg-critical/10 px-2 py-1.5 text-[11px] text-critical">
              <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden /> {actionError}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel className="overflow-hidden">
        <Tabs
          tabs={[
            { value: 'live', label: <><StatusDot tone={running ? 'brand' : 'muted'} pulse={running} /> Live feed</> },
            { value: 'rounds', label: <>Rounds <Badge variant="outline">{rounds.length}</Badge></> },
            { value: 'report', label: <>Report {campaign.hasReport ? <Badge variant="ok">ready</Badge> : null}</> },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'live' ? (
          <div>
            {phases ? <DeepPhases phases={phases} executionId={campaign.workflowExecutionId} /> : null}
            <LiveFeed events={events} running={running} />
          </div>
        ) : null}
        {tab === 'rounds' ? <RoundsList rounds={rounds} /> : null}
        {tab === 'report' ? (
          campaign.hasReport ? (
            report ? <ReportView report={report} /> : <p className="p-4 text-xs text-fg-subtle">Loading report…</p>
          ) : (
            <EmptyState
              icon={<Terminal aria-hidden />}
              title="No report yet"
              hint="Run the campaign — when it finishes, the full report (findings, severity, remediation and export) appears here."
            />
          )
        ) : null}
      </Panel>
    </div>
  )
}

/* --------------------------------- Live feed -------------------------------- */

/** AttackLoop phase board — one card per platform agent, updated live. */
function DeepPhases({ phases, executionId }: { phases: PhaseState[]; executionId: string | null }) {
  const done = phases.filter((p) => p.status === 'completed').length
  return (
    <section className="border-b border-line">
      <div className="flex flex-wrap items-start justify-between gap-2 px-3 py-2">
        <div>
          <div className="ink-label">AttackLoop workflow · deep scan phases</div>
          <p className="mt-0.5 text-[11px] text-fg-subtle">
            Four platform agents run in sequence — each phase reports here the moment the platform returns it.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {executionId ? (
            <Badge variant="outline" className="max-w-[240px] truncate normal-case" title={executionId}>
              exec {executionId}
            </Badge>
          ) : null}
          <Badge variant="outline">
            {done}/{phases.length} done
          </Badge>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-4">
        {phases.map((phase) => (
          <PhaseCard key={phase.order} phase={phase} />
        ))}
      </div>
    </section>
  )
}

function PhaseCard({ phase }: { phase: PhaseState }) {
  const Icon = PHASE_ICONS[phase.name] ?? Terminal
  const tone: Tone =
    phase.status === 'completed'
      ? 'ok'
      : phase.status === 'running'
        ? 'brand'
        : phase.status === 'failed'
          ? 'critical'
          : 'muted'
  return (
    <div className={cn('panel-flat flex flex-col gap-1.5 px-3 py-2.5', phase.status === 'running' && 'border-brand/40')}>
      <div className="flex items-center gap-2">
        <span className="text-fg-subtle [&_svg]:size-3.5">
          <Icon aria-hidden />
        </span>
        <span className="ink-label flex-1">phase {phase.order}</span>
        <ToneBadge
          tone={tone}
          label={phase.status === 'completed' ? 'done' : phase.status}
          className={phase.status === 'running' ? 'animate-pulse' : undefined}
        />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-fg">{phase.name}</span>
        {phase.durationMs != null ? (
          <span className="tabular font-mono text-[10px] text-fg-faint">{(phase.durationMs / 1000).toFixed(1)}s</span>
        ) : null}
      </div>
      <p className="text-[10.5px] leading-relaxed text-fg-subtle">{phase.role}</p>
      {phase.verdict ? (
        <div>
          <ToneBadge tone={severityTone(phase.verdict.severity)} label={`verdict: ${phase.verdict.severity}`} dot={false} />
        </div>
      ) : null}
      {phase.output ? (
        <details className="group mt-auto">
          <summary className="cursor-pointer list-none font-mono text-[10px] text-fg-faint transition-colors hover:text-fg-subtle">
            output · {phase.output.length.toLocaleString()} chars · click to expand
          </summary>
          <pre className="mt-1.5 max-h-44 overflow-auto rounded-xs border border-line bg-surface-0/60 p-2 font-mono text-[10.5px] leading-relaxed break-words whitespace-pre-wrap text-fg-muted">
            {phase.output}
          </pre>
        </details>
      ) : (
        <p className="mt-auto font-mono text-[10px] text-fg-faint">
          {phase.status === 'running' ? 'running — waiting for the platform…' : phase.status === 'pending' ? 'queued' : 'no output'}
        </p>
      )}
    </div>
  )
}

function LiveFeed({ events, running }: { events: AppEvent[]; running: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [events.length, follow])

  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <span className="text-[11px] text-fg-faint">
          {events.length === 0 ? 'Waiting for events…' : `${events.length} events`}
          {running ? ' · streaming' : ' · stream closed'}
        </span>
        <button
          type="button"
          onClick={() => setFollow((f) => !f)}
          className={cn(
            'rounded-xs border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors',
            follow ? 'border-brand/40 bg-brand/12 text-brand-soft' : 'border-line-strong bg-surface-2 text-fg-subtle',
          )}
        >
          follow
        </button>
      </div>
      <div
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          setFollow(atBottom)
        }}
        className="max-h-[560px] min-h-[220px] overflow-y-auto py-1"
      >
        {events.length === 0 ? (
          <p className="px-3 py-6 text-center text-[11px] text-fg-faint">
            The loop streams here: recon probes, attacker probes, target replies and judge verdicts.
          </p>
        ) : (
          events.map((ev) => {
            const meta = eventMeta(ev.type)
            const detail = eventDetail(ev)
            return (
              <div
                key={ev.seq}
                className="animate-stream-in flex items-start gap-2 px-3 py-1 font-mono text-[11px] leading-relaxed"
              >
                <span className="tabular shrink-0 pt-px text-[10px] text-fg-faint">{timeOf(ev.ts)}</span>
                <span className="w-[84px] shrink-0 pt-px">
                  <ToneBadge tone={meta.tone} label={meta.label} dot={false} className="justify-center" />
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 break-words',
                    detail.level === 'error'
                      ? 'text-critical'
                      : detail.level === 'warn'
                        ? 'text-warn'
                        : 'text-fg-muted',
                  )}
                >
                  {detail.text}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ---------------------------------- Rounds ---------------------------------- */

function RoundsList({ rounds }: { rounds: Round[] }) {
  if (rounds.length === 0) {
    return (
      <EmptyState
        icon={<Terminal aria-hidden />}
        title="No rounds recorded"
        hint="Every probe/response pair is stored as a round with the judge verdict attached."
      />
    )
  }
  return (
    <div className="space-y-3 p-3">
      {rounds.map((round) => (
        <RoundCard key={round.id} round={round} />
      ))}
    </div>
  )
}

function RoundCard({ round }: { round: Round }) {
  const verdict = round.verdict
  const label = round.phase.startsWith('recon')
    ? 'Recon'
    : round.phase.startsWith('deep')
      ? 'Deep scan'
      : 'Attack'

  return (
    <Panel className="animate-rise bg-surface-1/70">
      <PanelHeader
        dense
        icon={<Terminal aria-hidden />}
        eyebrow={`${label} · round ${round.idx}`}
        title={verdict?.vulnerability_type || (round.error ? 'Round failed' : 'Exchange recorded')}
        actions={
          <>
            {round.durationMs ? <Badge>{round.durationMs} ms</Badge> : null}
            {verdict ? <ToneBadge tone={severityTone(verdict.severity)} label={verdict.severity} /> : null}
            {verdict ? (
              <Badge variant={verdict.passed ? 'ok' : 'critical'}>{verdict.passed ? 'passed' : 'failed'}</Badge>
            ) : null}
          </>
        }
      />
      <PanelBody className="space-y-3 p-3">
        {round.error ? <p className="text-[11px] text-critical">{round.error}</p> : null}

        <div>
          <div className="ink-label mb-1">Probe sent</div>
          <pre className="max-h-40 overflow-y-auto rounded-sm border border-line bg-surface-0/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-fg">
            {round.probe || '—'}
          </pre>
        </div>

        <div>
          <div className="ink-label mb-1">Target reply</div>
          <pre className="max-h-48 overflow-y-auto rounded-sm border border-line bg-surface-0/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-fg-muted">
            {round.response || '—'}
          </pre>
        </div>

        {verdict ? (
          <div className="space-y-2 rounded-sm border border-line bg-surface-0/40 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ink-label">Verdict</span>
              <ToneBadge tone={severityTone(verdict.severity)} label={verdict.severity} />
              <Badge variant={verdict.passed ? 'ok' : 'critical'}>{verdict.passed ? 'passed' : 'failed'}</Badge>
            </div>
            {verdict.analysis ? (
              <p className="text-[11.5px] leading-relaxed text-fg-muted">{verdict.analysis}</p>
            ) : null}
            {verdict.remediation_patch ? (
              <div>
                <div className="ink-label mb-1">Suggested remediation</div>
                <pre className="max-h-48 overflow-y-auto rounded-sm border border-line bg-surface-0/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
                  {verdict.remediation_patch}
                </pre>
              </div>
            ) : null}
            {verdict.next_recommended_probe ? (
              <div>
                <div className="ink-label mb-1">Next recommended probe</div>
                <p className="text-[11.5px] leading-relaxed text-fg-subtle">{verdict.next_recommended_probe}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  )
}

/* ---------------------------------- Report ---------------------------------- */

function ReportView({ report }: { report: Report }) {
  const stats = report.stats
  const tiles = [
    { label: 'Total rounds', value: String(stats.totalRounds) },
    { label: 'Verdicts', value: `${stats.verdicts}` },
    { label: 'Passed / failed', value: `${stats.passed} / ${stats.failed}` },
    { label: 'Target time', value: `${(stats.totalTargetMs / 1000).toFixed(1)} s` },
  ]

  return (
    <div className="space-y-4 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToneBadge tone={severityTone(stats.worstSeverity)} label={`worst: ${stats.worstSeverity}`} />
        {Object.entries(stats.severityCounts).map(([sev, count]) => (
          <Badge key={sev} variant="outline">
            {sev} × {count}
          </Badge>
        ))}
        <span className="flex-1" />
        <span className="font-mono text-[10.5px] text-fg-faint">generated {dateOf(report.generatedAt)}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="panel-flat px-3 py-2.5">
            <div className="ink-label">{tile.label}</div>
            <div className="tabular mt-1 text-lg font-semibold text-fg">{tile.value}</div>
          </div>
        ))}
      </div>

      {report.findings.length === 0 ? (
        <EmptyState title="No verdicts recorded" hint="The loop finished without any judged exchange." />
      ) : (
        <div className="space-y-3">
          {report.findings.map((finding, i) => (
            <div key={`${finding.roundIdx}-${i}`} className="panel-flat p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-fg-faint">#{i + 1}</span>
                <ToneBadge tone={severityTone(finding.severity)} label={finding.severity} />
                <span className="text-[12.5px] font-medium text-fg">
                  {finding.vulnerability_type === 'Unknown' ? 'Unspecified' : finding.vulnerability_type}
                </span>
                <Badge variant={finding.passed ? 'ok' : 'critical'}>
                  {finding.passed === true ? 'passed' : finding.passed === false ? 'failed' : 'unknown'}
                </Badge>
                <span className="flex-1" />
                <span className="font-mono text-[10.5px] text-fg-faint">round {finding.roundIdx}</span>
              </div>
              <div className="mt-2 grid gap-3 lg:grid-cols-2">
                <div>
                  <div className="ink-label mb-1">Probe</div>
                  <pre className="max-h-36 overflow-y-auto rounded-sm border border-line bg-surface-0/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed break-words whitespace-pre-wrap text-fg">
                    {finding.probe}
                  </pre>
                </div>
                <div>
                  <div className="ink-label mb-1">Target reply</div>
                  <pre className="max-h-36 overflow-y-auto rounded-sm border border-line bg-surface-0/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed break-words whitespace-pre-wrap text-fg-muted">
                    {finding.response}
                  </pre>
                </div>
              </div>
              {finding.analysis ? (
                <p className="mt-2 text-[11.5px] leading-relaxed text-fg-muted">{finding.analysis}</p>
              ) : null}
              {finding.remediation_patch ? (
                <details className="mt-2 rounded-sm border border-line bg-surface-0/40 px-2.5 py-2">
                  <summary className="cursor-pointer text-[11px] text-fg-subtle select-none">
                    Suggested remediation
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-y-auto font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-fg-muted">
                    {finding.remediation_patch}
                  </pre>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <p className="border-t border-line pt-2 text-[10.5px] text-fg-faint">
        Export the same content as a standalone HTML file (report.html) or raw JSON from the header buttons.
        Generated by EVOLUS RED at <Mono>{report.generatedAt}</Mono>.
      </p>
    </div>
  )
}
