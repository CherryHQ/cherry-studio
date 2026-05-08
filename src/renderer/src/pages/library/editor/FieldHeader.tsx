import { FieldLabel, Tooltip } from '@cherrystudio/ui'
import { CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'

interface Props {
  label: ReactNode
  hint?: ReactNode
  className?: string
}

export function FieldHeader({ label, hint, className }: Props) {
  const iconLabel = typeof hint === 'string' ? hint : undefined

  return (
    <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
      <FieldLabel className="min-w-0 font-normal text-muted-foreground/80 text-sm">{label}</FieldLabel>
      {hint ? (
        <Tooltip
          content={hint}
          placement="top"
          className="max-w-sm px-2.5 py-1.5 text-xs leading-5"
          classNames={{ placeholder: 'inline-flex shrink-0' }}>
          <CircleHelp
            size={12}
            role="img"
            aria-label={iconLabel}
            className="cursor-help text-muted-foreground/45 transition-colors hover:text-muted-foreground/70"
          />
        </Tooltip>
      ) : null}
    </div>
  )
}
