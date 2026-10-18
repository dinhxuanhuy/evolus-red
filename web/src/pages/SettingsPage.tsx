import { Bot, FlaskConical, RefreshCw, Workflow } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { API_BASE, api, type Meta } from '../lib/api'
import { Badge, Button, KeyValue, Mono, Panel, PanelBody, PanelHeader, ToneBadge } from '../components/ui'

type MockInfo = {
  name: string
  url: string
  planted: string[]
  responseShape: Record<string, string>
}

export default function SettingsPage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [mock, setMock] = useState<MockInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setMeta(await api.meta())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    try {
      const mk = (await fetch(`${API_BASE}/api/mock/target/info`).then((r) => r.json())) as MockInfo
      setMock(mk)
    } catch {
      /* mock info is optional — hidden if the endpoint is unreachable */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Vercel static deployment: recorded data only — workflow control is disabled. */
  const demo = meta?.demo?.readOnly ? meta.demo : null

  const toggleWorkflow = async (active: boolean) => {
    const ok = window.confirm(
      active
        ? 'Enable the AttackLoop workflow for Deep scans?\n\nDeep scans run this workflow on the Evolus platform (recon → planner → attacker → judge) and can take 30–60 minutes per campaign. The quick loop does not need it.'
        : 'Disable the AttackLoop workflow?\n\nDeep scans will refuse to start until it is enabled again. Quick-loop campaigns keep working.',
    )
    if (!ok) return
    setBusy(true)
    try {
      await api.toggleWorkflow(active)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <header>
        <div className="ink-label">Platform</div>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-subtle">
          Evolus platform wiring used by every campaign: agents, the AttackLoop workflow gate and the local demo
          target. Credentials live in <Mono>server/.env</Mono> and are never exposed here.
        </p>
      </header>

      {error ? (
        <p className="rounded-sm border border-critical/35 bg-critical/10 px-2 py-1.5 text-[11px] text-critical">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader
            icon={<Workflow aria-hidden />}
            eyebrow="Deep scan gate"
            title="AttackLoop workflow"
            hint="Quick loops run directly on our server; Deep scans execute this workflow on Evolus."
            actions={
              meta?.workflow.isActive ? (
                <ToneBadge tone="ok" label="active" />
              ) : meta?.workflow.isActive === false ? (
                <ToneBadge tone="muted" label="off" />
              ) : (
                <ToneBadge tone="warn" label="unknown" />
              )
            }
          />
          <PanelBody className="space-y-3 p-3">
            <div className="space-y-0.5">
              <KeyValue k="Name" v={meta?.workflow.name ?? '—'} />
              <KeyValue k="Workflow id" v={meta?.workflow.id ?? '—'} />
              <KeyValue k="Updated" v={meta?.workflow.updatedAt ?? '—'} />
            </div>
            {meta?.workflow.error ? (
              <p className="text-[11px] text-warn">Could not read the workflow state: {meta.workflow.error}</p>
            ) : null}
            <p className="text-[11px] leading-relaxed text-fg-faint">
              Enabling or disabling takes effect immediately and applies to every future Deep scan. Nothing is
              activated automatically — the console only asks the Evolus API when you press the button.
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              {demo ? null : meta?.workflow.isActive ? (
                <Button variant="danger" loading={busy} onClick={() => void toggleWorkflow(false)}>
                  Disable workflow
                </Button>
              ) : (
                <Button variant="intel" loading={busy} onClick={() => void toggleWorkflow(true)}>
                  Enable workflow for Deep scans
                </Button>
              )}
              <Button onClick={() => void load()}>
                <RefreshCw aria-hidden /> Refresh state
              </Button>
            </div>
            {demo ? (
              <p className="text-[11px] leading-relaxed text-warn">
                Read-only demo — enabling or disabling the workflow runs on the self-hosted backend only.
              </p>
            ) : null}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            icon={<Bot aria-hidden />}
            eyebrow="Evolus agents"
            title="Registered agents"
            hint="IDs from server/.env — every round calls attacker and judge; recon runs first."
            actions={<Badge variant="outline">{meta?.agents.length ?? 0} agents</Badge>}
          />
          <PanelBody>
            {meta?.agents.map((agent) => (
              <div
                key={agent.key}
                className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-fg">{agent.label}</div>
                  <div className="truncate font-mono text-[10.5px] text-fg-faint">{agent.id}</div>
                </div>
                <Badge variant={agent.key === 'attacker' ? 'brand' : agent.key === 'judge' ? 'ok' : 'intel'}>
                  {agent.key}
                </Badge>
              </div>
            ))}
            <div className="border-t border-line px-3 py-2">
              <KeyValue k="Application" v={meta?.applicationId ?? '—'} />
            </div>
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-2">
          <PanelHeader
            icon={<FlaskConical aria-hidden />}
            eyebrow="Demo target"
            title="Mock vulnerable chatbot"
            hint="Local test endpoint with planted weaknesses — used by the 'Demo mock' button on New campaign."
            actions={
              <a href="/api/mock/target/info" target="_blank" rel="noreferrer">
                <Button>Raw info</Button>
              </a>
            }
          />
          <PanelBody className="grid gap-3 p-3 lg:grid-cols-2">
            <div>
              <div className="ink-label mb-1">Planted weaknesses</div>
              <ul className="space-y-1">
                {(mock?.planted ?? []).map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-muted">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                Post <Mono>{`${API_BASE}${mock?.url ?? '/api/mock/target'}`}</Mono> with{' '}
                <Mono>{'{"message": "…"}'}</Mono>. Sessions persist through the{' '}
                <Mono>x-session-id</Mono> header — the demo curl on New campaign sets one, so the mock remembers
                earlier rounds.
              </p>
            </div>
            <div>
              <div className="ink-label mb-1">Response shape</div>
              <div className="space-y-0.5">
                {Object.entries(mock?.responseShape ?? {}).map(([key, type]) => (
                  <KeyValue key={key} k={key} v={type} />
                ))}
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-fg-faint">
                Since the mock leaks its fake system prompt, expect at least one Critical/High verdict when you run
                the demo — then compare the exported report. Ready to try?{' '}
                <Link to="/new" className="text-brand hover:underline">
                  Start a demo campaign
                </Link>
                .
              </p>
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  )
}
