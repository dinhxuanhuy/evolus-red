import type { CampaignStatus } from './api'

export type Tone = 'ok' | 'warn' | 'critical' | 'brand' | 'intel' | 'muted'

export const toneBadge: Record<Tone, string> = {
  ok: 'border-ok/40 bg-ok/12 text-ok',
  warn: 'border-warn/40 bg-warn/12 text-warn',
  critical: 'border-critical/40 bg-critical/12 text-critical',
  brand: 'border-brand/40 bg-brand/12 text-brand-soft',
  intel: 'border-intel/40 bg-intel/12 text-intel',
  muted: 'border-line-strong bg-surface-2 text-fg-muted',
}

export const toneDot: Record<Tone, string> = {
  ok: 'bg-ok text-ok',
  warn: 'bg-warn text-warn',
  critical: 'bg-critical text-critical',
  brand: 'bg-brand text-brand',
  intel: 'bg-intel text-intel',
  muted: 'bg-fg-faint text-fg-faint',
}

export const statusMeta: Record<CampaignStatus, { tone: Tone; label: string }> = {
  draft: { tone: 'muted', label: 'draft' },
  running: { tone: 'brand', label: 'running' },
  finished: { tone: 'ok', label: 'finished' },
  stopped: { tone: 'warn', label: 'stopped' },
  error: { tone: 'critical', label: 'error' },
}

export function severityTone(severity: string | null | undefined): Tone {
  const s = (severity ?? '').toLowerCase()
  if (s.includes('critical')) return 'critical'
  if (s.includes('high')) return 'brand'
  if (s.includes('medium')) return 'warn'
  if (s.includes('low')) return 'intel'
  if (s.includes('safe')) return 'ok'
  return 'muted'
}

export function eventMeta(type: string): { tone: Tone; label: string } {
  if (type === 'round.verdict') return { tone: 'brand', label: 'verdict' }
  if (type === 'round.probe') return { tone: 'intel', label: 'attack probe' }
  if (type === 'round.response') return { tone: 'ok', label: 'target reply' }
  if (type === 'recon.probe') return { tone: 'intel', label: 'recon probe' }
  if (type === 'recon.response') return { tone: 'ok', label: 'target reply' }
  if (type === 'recon.profile') return { tone: 'intel', label: 'profile' }
  if (type === 'phase') return { tone: 'muted', label: 'phase' }
  if (type === 'report') return { tone: 'ok', label: 'report' }
  if (type === 'done') return { tone: 'ok', label: 'done' }
  if (type === 'error') return { tone: 'critical', label: 'error' }
  if (type === 'status') return { tone: 'muted', label: 'status' }
  if (type.startsWith('deep.')) return { tone: 'intel', label: type.replace('deep.', 'deep ') }
  return { tone: 'muted', label: type }
}

export function timeOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour12: false })
  } catch {
    return iso
  }
}

export function dateOf(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', hour12: false })
  } catch {
    return iso
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}
