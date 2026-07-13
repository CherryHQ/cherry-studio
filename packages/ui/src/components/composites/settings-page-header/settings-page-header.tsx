import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

type SettingsPageHeaderProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}

// Canonical settings page header: leading icon + 18px title + optional description / action.
// Renders an <h1> for accessibility; pages use this at the top, with group titles below.
function SettingsPageHeader({ icon, title, description, action, className, ...props }: SettingsPageHeaderProps) {
  return (
    <div
      data-slot="settings-page-header"
      className={cn('flex items-start justify-between gap-3', className)}
      {...props}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-foreground">
          {icon ? <span className="inline-flex shrink-0 [&_svg]:size-5 [&_svg]:text-foreground">{icon}</span> : null}
          <h1 className="m-0 select-none font-[550] text-lg leading-6">{title}</h1>
        </div>
        {description ? <p className="m-0 mt-1.5 text-foreground-muted text-xs">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

SettingsPageHeader.displayName = 'SettingsPageHeader'

export { SettingsPageHeader }
export type { SettingsPageHeaderProps }
