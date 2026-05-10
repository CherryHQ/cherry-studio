import { cn } from '@renderer/utils'
import type { FC, ReactNode } from 'react'

interface SettingsSectionProps {
  title: ReactNode
  badge?: ReactNode
  children: ReactNode
  className?: string
}

export const SettingsSection: FC<SettingsSectionProps> = ({ title, badge, children, className }) => (
  <section className={cn('rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-3.5 py-3', className)}>
    <div className="mb-2 flex items-center gap-2">
      <p className="font-medium text-foreground/70 text-xs leading-tight">{title}</p>
      {badge}
    </div>
    <div className="space-y-3">{children}</div>
  </section>
)

export const SettingsHelpIcon: FC<{ children: ReactNode }> = ({ children }) => (
  <span className="text-muted-foreground/25 transition-colors hover:text-muted-foreground/50">{children}</span>
)
