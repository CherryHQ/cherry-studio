import { Switch } from '@cherrystudio/ui/components/primitives/switch'
import type { ReactNode } from 'react'

type Props = {
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}

export function MultiSelectBar({ enabled, onEnabledChange, label, hint, disabled }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground/80">
        <span className="truncate">{label}</span>
        {hint ? <span className="truncate text-muted-foreground/60">{hint}</span> : null}
      </div>
      <Switch checked={enabled} onCheckedChange={onEnabledChange} disabled={disabled} />
    </div>
  )
}
