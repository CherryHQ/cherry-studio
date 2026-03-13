import { Divider } from '@cherrystudio/ui'
import { cn } from '@renderer/utils'
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

interface WebSearchSettingsShellProps {
  children: ReactNode
  sidebar: ReactNode
}

export const WebSearchSettingsShell = ({ children, sidebar }: WebSearchSettingsShellProps) => {
  return (
    <section className="flex h-[calc(100vh-var(--navbar-height)-6px)] min-h-0 w-full flex-col overflow-hidden lg:flex-row">
      <aside className="min-h-0 shrink-0 border-(--color-border) border-b bg-(--color-background) lg:w-[288px] lg:border-r lg:border-b-0">
        {sidebar}
      </aside>
      <div className="min-h-0 min-w-0 flex-1 bg-(--color-background-soft)">{children}</div>
    </section>
  )
}

export const WebSearchSettingsSidebar = ({ children, className, ...props }: HTMLAttributes<HTMLElement>) => {
  return (
    <nav className={cn('flex h-full min-h-0 flex-col gap-5 overflow-y-auto p-4', className)} {...props}>
      {children}
    </nav>
  )
}

interface WebSearchSettingsSidebarSectionProps {
  children: ReactNode
  title: string
}

export const WebSearchSettingsSidebarSection = ({ children, title }: WebSearchSettingsSidebarSectionProps) => {
  return (
    <section className="flex flex-col gap-2">
      <div className="px-2 font-semibold text-(--color-text-3) text-[11px] uppercase tracking-[0.08em]">{title}</div>
      <div className="flex flex-col gap-1">{children}</div>
    </section>
  )
}

interface WebSearchSettingsSidebarItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  active?: boolean
  icon?: ReactNode
  subtitle?: string
  title: ReactNode
}

export const WebSearchSettingsSidebarItem = ({
  active,
  className,
  icon,
  subtitle,
  title,
  type = 'button',
  ...props
}: WebSearchSettingsSidebarItemProps) => {
  return (
    <button
      type={type}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-transparent bg-transparent text-(--color-text-1) hover:border-(--color-border) hover:bg-(--color-background-soft)',
        className
      )}
      {...props}>
      {icon && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-(--color-background-soft)">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-sm">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-(--color-text-3) text-xs">{subtitle}</span>}
      </span>
    </button>
  )
}

export const WebSearchSettingsContent = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => {
  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4 sm:px-6 sm:py-5', className)} {...props}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">{children}</div>
    </div>
  )
}

interface WebSearchSettingsSectionProps {
  actions?: ReactNode
  children: ReactNode
  description?: ReactNode
  title: ReactNode
}

export const WebSearchSettingsSection = ({ actions, children, description, title }: WebSearchSettingsSectionProps) => {
  return (
    <section className="rounded-2xl border border-(--color-border) bg-(--color-background) p-5 shadow-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-(--color-text-1) text-base">{title}</div>
          {description && <p className="mt-2 text-(--color-text-2) text-sm leading-6">{description}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <Divider className="my-4" />
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

interface WebSearchSettingsFieldProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  description?: ReactNode
  title: ReactNode
}

export const WebSearchSettingsField = ({
  children,
  className,
  contentClassName,
  description,
  title
}: WebSearchSettingsFieldProps) => {
  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between', className)}>
      <div className="min-w-0 flex-1 lg:max-w-2xl">
        <div className="flex items-center gap-1.5 font-medium text-(--color-text-1) text-sm">{title}</div>
        {description && <p className="mt-1 text-(--color-text-2) text-sm leading-6">{description}</p>}
      </div>
      <div className={cn('w-full lg:max-w-90', contentClassName)}>{children}</div>
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
      className={cn('text-xs leading-5', tone === 'danger' ? 'text-destructive' : 'text-(--color-text-3)', className)}
      {...props}>
      {children}
    </p>
  )
}
