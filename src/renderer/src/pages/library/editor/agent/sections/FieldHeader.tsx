import { FieldLabel } from '@cherrystudio/ui'
import type { ReactNode } from 'react'

interface Props {
  label: ReactNode
  hint?: ReactNode
  className?: string
}

export function FieldHeader({ label, hint, className }: Props) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className ?? ''}`}>
      <FieldLabel className="shrink-0 font-normal text-muted-foreground/80 text-sm">{label}</FieldLabel>
      {hint ? <span className="max-w-[60%] text-right text-muted-foreground/50 text-xs leading-4">{hint}</span> : null}
    </div>
  )
}
