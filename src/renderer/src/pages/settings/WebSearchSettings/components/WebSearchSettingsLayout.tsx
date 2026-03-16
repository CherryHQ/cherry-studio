import { cn } from '@renderer/utils'
import { ChevronRight } from 'lucide-react'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

interface WebSearchSettingsShellProps {
  children: ReactNode
  sidebar: ReactNode
}

export const WebSearchSettingsShell = ({ children, sidebar }: WebSearchSettingsShellProps) => {
  return (
    <section className="my-2 mr-2 flex h-[calc(100vh-var(--navbar-height)-10px)] min-h-0 w-full flex-1 overflow-hidden rounded-2xl border border-foreground/6 bg-foreground/2 lg:flex-row">
      <aside className="min-h-0 shrink-0 border-foreground/5 border-b lg:w-40 lg:border-r lg:border-b-0">
        {sidebar}
      </aside>
      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </section>
  )
}

export const WebSearchSettingsSidebar = ({ children, className, ...props }: HTMLAttributes<HTMLElement>) => {
  return (
    <nav className={cn('flex h-full min-h-0 flex-col', className)} {...props}>
      {children}
    </nav>
  )
}

export const WebSearchSettingsSidebarHeader = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div className={cn('px-3.5 pt-4 pb-2 font-medium text-[11px] text-foreground', className)} {...props}>
      {children}
    </div>
  )
}

export const WebSearchSettingsSidebarBody = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'flex-1 overflow-y-auto px-2.5 pb-3 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-0.5',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

interface WebSearchSettingsSidebarSectionProps {
  children: ReactNode
  title: string
}

export const WebSearchSettingsSidebarSection = ({ children, title }: WebSearchSettingsSidebarSectionProps) => {
  return (
    <section className="flex flex-col gap-1">
      <div className="px-3 font-medium text-[10px] text-foreground uppercase tracking-[0.08em]">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

interface WebSearchSettingsSidebarItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  active?: boolean
  icon?: ReactNode
  subtitle?: string
  title: ReactNode
  trailing?: ReactNode
}

export const WebSearchSettingsSidebarItem = ({
  active,
  className,
  icon,
  subtitle,
  title,
  trailing,
  type = 'button',
  ...props
}: WebSearchSettingsSidebarItemProps) => {
  return (
    <button
      type={type}
      className={cn(
        'group relative flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2 text-left transition-all',
        'text-foreground hover:bg-foreground/3',
        active && 'bg-foreground/5.5',
        className
      )}
      {...props}>
      {active && (
        <>
          <span className="pointer-events-none absolute inset-0 rounded-xl border border-foreground/10" />
          <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 flex items-center">
            <span className="h-6 w-2.5 rounded-l-3xs bg-emerald-500/15 blur-[6px]" />
            <span className="absolute right-0 h-2.5 w-0.75 rounded-full bg-emerald-400/75 blur-[2px]" />
          </span>
        </>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {icon && <span className="flex shrink-0 items-center justify-center text-foreground">{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[10px] text-foreground', active ? 'font-medium' : 'font-normal')}>
            {title}
          </span>
          {subtitle && <span className="mt-0.5 block truncate text-[9px] text-foreground">{subtitle}</span>}
        </span>
      </span>
      <span className="shrink-0 text-foreground transition-colors">{trailing ?? <ChevronRight size={9} />}</span>
    </button>
  )
}

export const WebSearchSettingsBadge = ({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md bg-emerald-500/10 px-1.5 py-px font-medium text-[9px] text-emerald-500',
        className
      )}
      {...props}>
      {children}
    </span>
  )
}

interface WebSearchSettingsPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}

export const WebSearchSettingsPanel = ({ children, className, ...props }: WebSearchSettingsPanelProps) => {
  return (
    <section className={cn('min-h-full rounded-[22px] px-6 py-5', className)} {...props}>
      {children}
    </section>
  )
}

interface WebSearchSettingsPanelHeaderProps {
  actions?: ReactNode
  icon: ReactNode
  subtitle?: ReactNode
  title: ReactNode
}

export const WebSearchSettingsPanelHeader = ({ actions, icon, subtitle, title }: WebSearchSettingsPanelHeaderProps) => {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xs bg-foreground/4 text-foreground">
          {icon && <span className="flex shrink-0 items-center justify-center text-foreground">{icon}</span>}
        </div>
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-[13px] text-foreground">{title}</h3>
          {subtitle && <p className="mt-0.5 truncate text-[9px] text-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  )
}

export const WebSearchSettingsContent = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col overflow-y-auto px-6 py-5 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-0.75',
        className
      )}
      {...props}>
      {children}
    </div>
  )
}

interface WebSearchSettingsSectionProps {
  actions?: ReactNode
  badge?: ReactNode
  children: ReactNode
  description?: ReactNode
  title: ReactNode
}

export const WebSearchSettingsSection = ({
  actions,
  badge,
  children,
  description,
  title
}: WebSearchSettingsSectionProps) => {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-3 flex items-center gap-2">
        <h4 className="font-medium text-[11px] text-foreground">{title}</h4>
        {badge}
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {description && <p className="mb-3 text-[9px] text-foreground leading-4">{description}</p>}
      <div className="space-y-3.5">{children}</div>
    </section>
  )
}

interface WebSearchSettingsFieldProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  description?: ReactNode
  layout?: 'inline' | 'stacked'
  meta?: ReactNode
  title?: ReactNode
}

export const WebSearchSettingsField = ({
  children,
  className,
  contentClassName,
  description,
  layout = 'stacked',
  meta,
  title
}: WebSearchSettingsFieldProps) => {
  return (
    <div
      className={cn(
        layout === 'inline' ? 'flex items-center justify-between gap-3' : 'flex flex-col gap-1.5',
        className
      )}>
      <div className={cn('min-w-0', layout === 'inline' && 'flex-1')}>
        {(title || meta) && (
          <div className="flex items-center gap-1.5">
            {title && (
              <div className="flex min-h-4 min-w-0 flex-wrap items-center gap-1.5 font-medium text-[10px] text-foreground leading-4">
                {title}
              </div>
            )}
            {meta}
          </div>
        )}
        {description && <p className="mt-1 text-[9px] text-foreground leading-4">{description}</p>}
      </div>
      <div className={cn(layout === 'inline' ? 'shrink-0' : 'w-full', contentClassName)}>{children}</div>
    </div>
  )
}

interface WebSearchSettingsHintProps extends HTMLAttributes<HTMLParagraphElement> {
  tone?: 'default' | 'danger'
}

export const WebSearchSettingsHint = ({
  children,
  className,
  tone = 'default',
  ...props
}: WebSearchSettingsHintProps) => {
  return (
    <p
      className={cn('text-[9px] leading-4', tone === 'danger' ? 'text-destructive' : 'text-foreground', className)}
      {...props}>
      {children}
    </p>
  )
}
