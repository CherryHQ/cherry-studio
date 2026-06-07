import type { IconComponent } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Pin, PinOff } from 'lucide-react'
import type { MouseEventHandler } from 'react'

interface CodeToolCardProps {
  icon: IconComponent
  title: string
  subtitle?: string
  selected?: boolean
  pinned?: boolean
  onClick: MouseEventHandler<HTMLButtonElement>
  onTogglePin?: () => void
}

const ICON_BOX_SIZE = 36
const ICON_BOX_RADIUS = Math.round(ICON_BOX_SIZE * 0.25)

export function CodeToolCard({
  icon: Icon,
  title,
  subtitle,
  selected = false,
  pinned,
  onClick,
  onTogglePin
}: CodeToolCardProps) {
  return (
    <button
      type="button"
      data-selected={selected || undefined}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-start rounded-2xl border border-border/70 bg-card p-4 text-left transition-[background-color,border-color] duration-200 ease-out',
        'hover:border-border hover:bg-background-subtle',
        selected && 'border-border-active ring-1 ring-ring/30',
        pinned && 'border-border'
      )}>
      {onTogglePin && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onTogglePin()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              e.stopPropagation()
              onTogglePin()
            }
          }}
          className={cn(
            'absolute top-2 right-2 z-10 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-opacity',
            pinned ? 'text-foreground opacity-100' : 'hover:!opacity-100 opacity-0 group-hover:opacity-60'
          )}>
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </span>
      )}
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
