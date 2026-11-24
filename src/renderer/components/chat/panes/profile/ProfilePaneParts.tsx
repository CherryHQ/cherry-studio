import { ChevronDown, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

/** A titled group: the label row (with an optional action on the right) above a bordered card. */
export function ProfilePaneSection({
  title,
  action,
  framed = true,
  children
}: {
  title: string
  action?: ReactNode
  /** False for lists whose rows are cards of their own. */
  framed?: boolean
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <div className="flex h-5 items-center justify-between px-1">
        <span className="text-muted-foreground text-xs">{title}</span>
        {action}
      </div>
      {framed ? <div className="rounded-xl border border-border-subtle px-3 py-1">{children}</div> : children}
    </section>
  )
}

export function ProfilePaneSectionAction({
  children,
  onClick,
  withChevron = false
}: {
  children: ReactNode
  onClick: () => void
  withChevron?: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="h-5 min-h-0 gap-0.5 px-1 font-normal text-muted-foreground text-xs shadow-none hover:bg-transparent hover:text-foreground">
      {children}
      {withChevron ? <ChevronRight className="size-3" /> : null}
    </Button>
  )
}

export function ProfileSettingsRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-1.5">
      <div className="min-w-0 truncate text-foreground text-sm">{label}</div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** A settings value that opens the edit dialog on the page where it is changed. */
export function ProfileSettingButton({
  label,
  value,
  icon,
  onClick,
  className
}: {
  /** The row label, so the accessible name says which setting this is. */
  label: string
  value: string
  icon?: ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={`${label}: ${value}`}
      onClick={onClick}
      className={cn(
        'h-8 max-w-48 justify-between gap-1.5 rounded-lg border-0 bg-muted/50 px-2.5 font-normal text-[13px] text-foreground shadow-none hover:bg-muted',
        className
      )}>
      {icon}
      <span className="min-w-0 truncate">{value}</span>
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </Button>
  )
}

/** Who it is: the large avatar (changed in place), the name and the description. */
export function ProfilePaneHeader({
  avatar,
  name,
  description
}: {
  avatar: ReactNode
  name: string
  description?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      {avatar}
      <h2 className="mt-2 font-semibold text-foreground text-lg leading-tight">{name}</h2>
      {description ? <p className="line-clamp-2 px-2 text-[13px] text-muted-foreground">{description}</p> : null}
    </div>
  )
}
