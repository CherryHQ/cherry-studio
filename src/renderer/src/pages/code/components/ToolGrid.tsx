import type { IconComponent } from '@cherrystudio/ui/icons'
import { cn } from '@cherrystudio/ui/lib/utils'

import { CliIconBadge } from './CliIconBadge'
import type { CodeToolMeta } from './types'

interface ToolGridProps<T extends { value: string; label: string; icon: IconComponent | null | undefined }> {
  title?: string
  tools: readonly T[]
  activeValue?: string
  onSelect: (value: T['value']) => void
  toMeta: (tool: T) => CodeToolMeta
}

export function ToolGrid<T extends { value: string; label: string; icon: IconComponent | null | undefined }>({
  title,
  tools,
  activeValue,
  onSelect,
  toMeta
}: ToolGridProps<T>) {
  if (tools.length === 0) return null

  return (
    <div className="mb-5">
      {title && <p className="mb-3 px-1 text-[10px] text-muted-foreground/70">{title}</p>}
      <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-6 md:grid-cols-8">
        {tools.map((tool) => {
          const meta = toMeta(tool)
          const active = activeValue === tool.value
          return (
            <button
              key={tool.value}
              type="button"
              onClick={() => onSelect(tool.value)}
              className="group relative flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  'shadow-sm transition-transform group-hover:scale-110',
                  active && 'rounded-2xs ring-2 ring-primary'
                )}>
                <CliIconBadge tool={meta} size={44} />
              </div>
              <span className="max-w-17 truncate text-[10px] text-muted-foreground transition-colors group-hover:text-foreground">
                {tool.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
