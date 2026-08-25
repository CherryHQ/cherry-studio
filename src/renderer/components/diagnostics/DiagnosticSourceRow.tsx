import { Switch } from '@cherrystudio/ui'

interface DiagnosticSourceRowProps {
  readonly checked: boolean
  readonly description: string
  readonly disabled: boolean
  readonly onCheckedChange?: (checked: boolean) => void
  readonly title: string
}

export function DiagnosticSourceRow({
  checked,
  description,
  disabled,
  onCheckedChange,
  title
}: DiagnosticSourceRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch aria-label={title} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  )
}
