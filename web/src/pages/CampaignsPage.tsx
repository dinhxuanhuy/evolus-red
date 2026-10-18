import { ArrowRight, Crosshair, Plus, RefreshCw, Terminal } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, reportMdUrl, type Campaign } from '../lib/api'
import { dateOf, hostOf, statusMeta } from '../lib/tone'
import {
  Badge,
  Button,
  EmptyState,
  Panel,
  PanelBody,
  PanelHeader,
  ToneBadge,
  cn,
} from '../components/ui'

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="panel-flat px-3 py-2.5">
      <div className="ink-label">{label}</div>
      <div className={cn('tabular mt-1 text-lg font-semibold text-fg', tone)}>{value}</div>
    </div>
  )
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      setCampaigns(await api.listCampaigns())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 8000)
    return () => window.clearInterval(timer)
  }, [load])

  const list = campaigns ?? []
  const running = list.filter((c) => c.running).length
  const drafts = list.filter((c) => c.status === 'draft').length
  const withReport = list.filter((c) => c.hasReport).length

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="ink-label">Operations</div>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-fg">Campaigns</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-subtle">
            Authorized red-team loops against chat endpoints. Import a curl once, then every round the
            Evolus agents probe, score and document the target until a full report is ready.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => void load()}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
          <Link to="/new">
            <Button variant="primary">
              <Plus aria-hidden /> New campaign
            </Button>
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total campaigns" value={list.length} />
        <Stat label="Running now" value={running} tone={running > 0 ? 'text-brand' : undefined} />
        <Stat label="Drafts" value={drafts} />
        <Stat label="Reports ready" value={withReport} />
      </div>

      <Panel>
        <PanelHeader
          icon={<Crosshair aria-hidden />}
          eyebrow="Red-team log"
          title="All campaigns"
          hint="Newest first. Row click opens the live console; the .md link downloads the exported report."
          actions={
            <Badge variant="outline">
              {list.length} total
            </Badge>
          }
        />
        <PanelBody>
          {error ? (
            <div className="p-4">
              <p className="text-xs text-critical">Could not load campaigns: {error}</p>
              <Button className="mt-2" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : campaigns === null ? (
            <p className="p-4 text-xs text-fg-subtle">Loading campaigns…</p>
          ) : list.length === 0 ? (
            <EmptyState
              icon={<Terminal aria-hidden />}
              title="No campaigns yet"
              hint="Paste a curl from your browser DevTools (Copy as cURL) on the New campaign page — the endpoint, headers and request body are parsed automatically."
              action={
                <Link to="/new">
                  <Button variant="primary">
                    <Plus aria-hidden /> New campaign
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <thead>
                  <tr>
                    <th className="ink-label px-3 py-2 font-medium">Campaign</th>
                    <th className="ink-label px-3 py-2 font-medium">Status</th>
                    <th className="ink-label px-3 py-2 font-medium">Mode</th>
                    <th className="ink-label px-3 py-2 font-medium">Target</th>
                    <th className="ink-label px-3 py-2 font-medium">Created</th>
                    <th className="ink-label px-3 py-2 text-right font-medium">Report</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => navigate(`/campaigns/${c.id}`)}
                      className="cursor-pointer border-t border-line transition-colors hover:bg-surface-2/70"
                    >
                      <td className="max-w-[260px] px-3 py-2">
                        <div className="truncate text-[12.5px] font-medium text-fg">{c.name}</div>
                        <div className="truncate font-mono text-[10.5px] text-fg-faint">{c.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <ToneBadge tone={statusMeta[c.status].tone} label={statusMeta[c.status].label} />
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={c.mode === 'deep' ? 'intel' : 'outline'}>
                          {c.mode === 'deep' ? 'deep scan' : 'quick loop'}
                        </Badge>
                      </td>
                      <td className="max-w-[220px] px-3 py-2">
                        <span className="block truncate font-mono text-[11px] text-fg-muted" title={c.target.url}>
                          {hostOf(c.target.url ?? '')}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-fg-faint">
                          {c.target.method ?? 'POST'} · max {c.maxRounds} rounds
                        </span>
                      </td>
                      <td className="px-3 py-2 text-[11px] whitespace-nowrap text-fg-subtle">
                        {dateOf(c.createdAt)}
                      </td>
                      <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                        {c.hasReport ? (
                          <a
                            href={reportMdUrl(c.id)}
                            className="font-mono text-[11px] text-brand hover:underline"
                            download
                          >
                            report.md
                          </a>
                        ) : (
                          <span className="text-[11px] text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-fg-faint">
                        <ArrowRight className="size-3.5" aria-hidden />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
