import { cn } from '@renderer/utils/style'
import type { ReactNode } from 'react'

type SettingsSectionProps = {
  title: ReactNode
  children: ReactNode
  className?: string
}

export function SettingsSection({ title, children, className }: SettingsSectionProps) {
  return (
    <section className={cn('rounded-xl border border-foreground/[0.06] bg-foreground/[0.03] px-3.5 py-3', className)}>
      <div className="mb-2 text-foreground/70 text-sm leading-tight" style={{ fontWeight: 500 }}>
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}
