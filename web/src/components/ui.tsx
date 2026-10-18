import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import type { Tone } from '../lib/tone'
import { toneBadge, toneDot } from '../lib/tone'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* ---------------------------------- Panel ---------------------------------- */

export function Panel({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section className={cn('panel flex min-w-0 flex-col', className)} {...props}>
      {children}
    </section>
  )
}

export function PanelHeader({
  title,
  eyebrow,
  hint,
  actions,
  icon,
  dense = false,
  className,
}: {
  title: ReactNode
  eyebrow?: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  dense?: boolean
  className?: string
}) {
  return (
    <header className={cn('flex items-start gap-3 border-b border-line px-3', dense ? 'py-2' : 'py-2.5', className)}>
      {icon ? <span className="mt-0.5 text-fg-subtle [&_svg]:size-3.5">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {eyebrow ? <div className="ink-label mb-0.5">{eyebrow}</div> : null}
        <h2 className="truncate text-[13px] font-semibold text-fg">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] text-fg-subtle">{hint}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  )
}

export function PanelBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('min-h-0 flex-1', className)} {...props}>
      {children}
    </div>
  )
}

/* ---------------------------------- Badge ---------------------------------- */

export type BadgeVariant = 'default' | 'outline' | 'critical' | 'warn' | 'ok' | 'brand' | 'intel' | 'solid'

const badgeVariants: Record<BadgeVariant, string> = {
  default: 'border-line-strong bg-surface-2 text-fg-muted',
  outline: 'border-line bg-transparent text-fg-subtle',
  critical: 'border-critical/40 bg-critical/12 text-critical',
  warn: 'border-warn/40 bg-warn/12 text-warn',
  ok: 'border-ok/40 bg-ok/12 text-ok',
  brand: 'border-brand/40 bg-brand/12 text-brand-soft',
  intel: 'border-intel/40 bg-intel/12 text-intel',
  solid: 'border-transparent bg-fg text-surface-0',
}

export function Badge({
  variant = 'default',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-px font-mono text-[10px] font-medium tracking-wider whitespace-nowrap uppercase',
        badgeVariants[variant],
        className,
      )}
      {...props}
    />
  )
}

/** Tone-driven chip with a leading dot — stages, verdicts, statuses. */
export function ToneBadge({ tone, label, dot = true, className }: { tone: Tone; label: string; dot?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-xs border px-1.5 py-px font-mono text-[10px] font-semibold tracking-wider whitespace-nowrap uppercase',
        toneBadge[tone],
        className,
      )}
    >
      {dot ? <span className={cn('size-1.5 rounded-full', toneDot[tone])} aria-hidden /> : null}
      {label}
    </span>
  )
}

export function StatusDot({ tone = 'ok', pulse = false, className }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn('relative inline-flex size-1.5 shrink-0 rounded-full', toneDot[tone], className)}>
      {pulse ? <span className={cn('absolute inset-0 animate-pulse-ring rounded-full', toneDot[tone])} /> : null}
    </span>
  )
}

export function KeyValue({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/70 py-1.5 last:border-0">
      <span className="ink-label shrink-0">{k}</span>
      <span className={cn('truncate text-right text-xs text-fg', mono && 'font-mono')}>{v}</span>
    </div>
  )
}

/* ---------------------------------- Button --------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'warn' | 'ok' | 'intel'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-brand font-semibold text-white hover:bg-brand-soft',
  secondary: 'border border-line-strong bg-surface-2 text-fg hover:border-line-bright hover:bg-surface-3',
  outline: 'border border-line bg-transparent text-fg-muted hover:border-line-bright hover:bg-surface-2 hover:text-fg',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg',
  danger: 'border border-critical/40 bg-critical/12 text-critical hover:bg-critical/20',
  warn: 'border border-warn/40 bg-warn/12 text-warn hover:bg-warn/20',
  ok: 'border border-ok/40 bg-ok/12 text-ok hover:bg-ok/20',
  intel: 'border border-intel/40 bg-intel/12 text-intel hover:bg-intel/20',
}

const buttonSizes: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-[11px] [&_svg]:size-3',
  sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
  md: 'h-8 px-3 text-[13px] [&_svg]:size-4',
  lg: 'h-9 px-4 text-sm [&_svg]:size-4',
  icon: 'size-7 [&_svg]:size-4',
  'icon-sm': 'size-6 [&_svg]:size-3.5',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  className,
  variant = 'secondary',
  size = 'sm',
  type = 'button',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  )
}

/* ------------------------------ Fields / inputs ----------------------------- */

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="ink-label mb-1 block">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[10.5px] leading-snug text-fg-faint">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-7 w-full rounded-sm border border-line-strong bg-surface-0/60 px-2 font-mono text-xs text-fg transition-colors placeholder:text-fg-faint hover:border-line-bright focus-visible:border-brand/60',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-y rounded-sm border border-line-strong bg-surface-0/60 px-2 py-1.5 text-xs leading-relaxed text-fg transition-colors placeholder:text-fg-faint hover:border-line-bright focus-visible:border-brand/60',
        className,
      )}
      {...props}
    />
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="inline-flex rounded-sm border border-line-strong bg-surface-0/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-xs px-2 py-1 text-[11px] font-medium transition-colors',
            value === option.value ? 'bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--color-line-bright)]' : 'text-fg-subtle hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------- Misc bits --------------------------------- */

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon ? <span className="text-fg-faint [&_svg]:size-6">{icon}</span> : null}
      <p className="text-[13px] font-medium text-fg-muted">{title}</p>
      {hint ? <p className="max-w-md text-[11px] leading-relaxed text-fg-faint">{hint}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-3" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-2 py-2 text-xs font-medium transition-colors',
            value === tab.value ? 'border-brand text-fg' : 'border-transparent text-fg-subtle hover:text-fg-muted',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-[11px] break-all text-fg-muted', className)}>{children}</span>
}
