import {
  Activity,
  Crosshair,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Square,
  Workflow,
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { api, type Campaign, type Meta } from '../lib/api'
import { statusMeta } from '../lib/tone'
import { Badge, Button, StatusDot, ToneBadge, cn } from './ui'

function navClass(active: boolean): string {
  return cn(
    'group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] font-medium transition-colors',
    active
      ? 'bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
      : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="ink-label px-2 pt-4 pb-1.5">{children}</div>
}

export function Shell({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const [busyStop, setBusyStop] = useState<string | null>(null)
  const location = useLocation()

  const refresh = useCallback(async () => {
    try {
      const [list, info] = await Promise.all([api.listCampaigns(), api.meta()])
      setCampaigns(list)
      setMeta(info)
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 8000)
    return () => window.clearInterval(timer)
  }, [refresh, location.pathname])

  const running = campaigns.filter((c) => c.running)
  const workflow = meta?.workflow

  const stopCampaign = async (id: string) => {
    setBusyStop(id)
    try {
      await api.stop(id)
      await refresh()
    } catch {
      /* the poll will reconcile */
    } finally {
      setBusyStop(null)
    }
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-0 text-fg">
      {/* ------------------------------- Sidebar ------------------------------- */}
      <aside className="hidden w-[238px] shrink-0 flex-col border-r border-line bg-surface-1 lg:flex">
        <div className="flex items-center gap-2.5 border-b border-line px-3 py-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-brand/40 bg-brand/12 text-brand">
            <Crosshair className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] leading-tight font-semibold tracking-wide text-fg">
              EVOLUS RED
            </div>
            <div className="truncate text-[10.5px] leading-tight text-fg-subtle">LLM red-team console</div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="pt-2">
            <NavLink to="/" end className={({ isActive }) => navClass(isActive)}>
              <LayoutDashboard className="size-3.5 text-fg-subtle group-hover:text-fg-muted" aria-hidden />
              <span className="flex-1">Campaigns</span>
              <Badge variant="outline">{campaigns.length}</Badge>
            </NavLink>
            <NavLink to="/new" className={({ isActive }) => navClass(isActive)}>
              <Plus className="size-3.5 text-fg-subtle group-hover:text-fg-muted" aria-hidden />
              <span className="flex-1">New campaign</span>
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => navClass(isActive)}>
              <Settings className="size-3.5 text-fg-subtle group-hover:text-fg-muted" aria-hidden />
              <span className="flex-1">Settings</span>
            </NavLink>
          </div>

          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <Activity className="size-3" aria-hidden /> Running now
            </span>
          </SectionLabel>
          {running.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-fg-faint">No campaign is running.</p>
          ) : (
            <ul className="space-y-1">
              {running.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-md border border-brand/25 bg-brand/[0.06] px-2 py-1.5"
                >
                  <StatusDot tone="brand" pulse />
                  <Link
                    to={`/campaigns/${c.id}`}
                    className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-fg hover:underline"
                  >
                    {c.name}
                  </Link>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Stop ${c.name}`}
                    loading={busyStop === c.id}
                    onClick={() => void stopCampaign(c.id)}
                  >
                    <Square aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <SectionLabel>
            <span className="inline-flex items-center gap-1.5">
              <Workflow className="size-3" aria-hidden /> Platform
            </span>
          </SectionLabel>
          <div className="rounded-md border border-line bg-surface-0/50 px-2 py-1.5">
            <div className="flex items-center gap-2">
              <StatusDot tone={workflow?.isActive ? 'ok' : workflow?.isActive === false ? 'muted' : 'warn'} />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-muted">AttackLoop workflow</span>
              <span className={cn('font-mono text-[10px] uppercase', workflow?.isActive ? 'text-ok' : 'text-fg-faint')}>
                {workflow?.isActive === null || workflow?.isActive === undefined ? 'unknown' : workflow.isActive ? 'on' : 'off'}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <StatusDot tone="intel" />
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-fg-muted">
                {meta ? `${meta.agents.length} agents` : 'agents —'}
              </span>
            </div>
          </div>
        </nav>

        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <Server className="size-3.5 text-fg-subtle" aria-hidden />
          <span className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <StatusDot tone={online === null ? 'warn' : online ? 'ok' : 'critical'} pulse={online === false} />
            {online === null ? 'checking server…' : online ? 'server online' : 'server offline'}
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="icon-sm" aria-label="Refresh" onClick={() => void refresh()}>
            <RefreshCw aria-hidden />
          </Button>
        </div>
      </aside>

      {/* -------------------------------- Content ------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar campaigns={campaigns} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] p-4 lg:p-6">{children}</div>
        </main>
      </div>
    </div>
  )
}

function Topbar({ campaigns }: { campaigns: Campaign[] }) {
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  const activeCampaign =
    segments[0] === 'campaigns' && segments[1]
      ? campaigns.find((c) => c.id === segments[1]) ?? null
      : null

  const crumbs: { label: string; to?: string; mono?: boolean }[] = [{ label: 'Operations', to: '/' }]
  if (segments[0] === 'new') crumbs.push({ label: 'New campaign' })
  if (segments[0] === 'settings') crumbs.push({ label: 'Settings' })
  if (segments[0] === 'campaigns') {
    crumbs.push({ label: 'Campaigns', to: '/' })
    if (segments[1]) crumbs.push({ label: activeCampaign?.name ?? 'campaign', mono: true, to: undefined })
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface-1/80 px-4 backdrop-blur">
      <nav className="flex min-w-0 items-center gap-1.5 text-[11.5px]">
        {crumbs.map((crumb, i) => (
          <span key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <span className="text-fg-faint">/</span> : null}
            {crumb.to && i < crumbs.length - 1 ? (
              <Link to={crumb.to} className="text-fg-subtle transition-colors hover:text-fg">
                {crumb.label}
              </Link>
            ) : (
              <span
                className={cn(
                  'truncate text-fg-muted',
                  crumb.mono && 'max-w-[280px] font-mono text-[11px]',
                  i === crumbs.length - 1 && 'text-fg',
                )}
              >
                {crumb.label}
              </span>
            )}
          </span>
        ))}
      </nav>

      <span className="flex-1" />

      {activeCampaign ? (
        <span className="hidden items-center gap-2 md:flex">
          <ToneBadge tone={statusMeta[activeCampaign.status].tone} label={statusMeta[activeCampaign.status].label} />
          <Badge variant={activeCampaign.mode === 'deep' ? 'intel' : 'outline'}>
            {activeCampaign.mode === 'deep' ? 'deep scan' : 'quick loop'}
          </Badge>
        </span>
      ) : null}

      <Link to="/new" className="hidden sm:block">
        <Button variant="primary">
          <Plus aria-hidden /> New campaign
        </Button>
      </Link>
    </header>
  )
}
