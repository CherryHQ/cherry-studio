import type { IconComponent } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { MouseEventHandler } from 'react'

interface CodeToolCardProps {
  icon: IconComponent
  title: string
  subtitle?: string
  selected?: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
}

const ICON_BOX_SIZE = 36
const ICON_BOX_RADIUS = Math.round(ICON_BOX_SIZE * 0.25)

export function CodeToolCard({ icon: Icon, title, subtitle, selected = false, onClick }: CodeToolCardProps) {
  return (
    <button
      type="button"
      data-selected={selected || undefined}
      onClick={onClick}
      className={cn(
        'group flex flex-col items-start rounded-2xl border border-border/70 bg-card p-4 text-left transition-[background-color,border-color] duration-200 ease-out',
        'hover:border-border hover:bg-background-subtle',
        selected && 'border-border-active ring-1 ring-ring/30'
      )}>
      <div
        className="flex shrink-0 items-center justify-center overflow-hidden"
        style={{ width: ICON_BOX_SIZE, height: ICON_BOX_SIZE, borderRadius: ICON_BOX_RADIUS }}>
        <Icon width={ICON_BOX_SIZE} height={ICON_BOX_SIZE} className="text-foreground" aria-label={title} />
      </div>
      <p className="mt-4 self-stretch truncate font-medium text-foreground text-sm">{title}</p>
      {subtitle && (
        <p className="mt-2 line-clamp-2 self-stretch text-foreground-muted text-xs leading-relaxed">{subtitle}</p>
      )}
    </button>
  )
}
