import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

export const RagFieldLabel = ({ className, label, hint }: { className?: string; label: string; hint?: string }) => {
  return (
    <div className={cn('mb-2 flex items-center gap-1.5', className)}>
      <span className="font-medium text-foreground text-sm">{label}</span>
      {hint ? (
        <Tooltip content={hint} placement="top" className="w-fit max-w-sm px-2.5 py-1.5 text-[10px] leading-relaxed">
          <Info size={12} className="cursor-help text-muted-foreground" />
        </Tooltip>
      ) : null}
    </div>
  )
}

export const RagSelectField = ({
  value,
  options,
  placeholder,
  onValueChange
}: {
  value?: string
  options: KnowledgeSelectOption[]
  placeholder?: string
  onValueChange: (value: string) => void
}) => {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** A single settings row: label (with optional hint) on the left, control on the right. */
export const RagFieldRow = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => {
  return (
    <div className="flex items-center justify-between gap-3">
      <RagFieldLabel label={label} hint={hint} className="mb-0" />
      {children}
    </div>
  )
}

/** A {@link RagFieldRow} whose control is a fixed-width text input with an optional trailing unit. */
export const RagInlineField = ({
  label,
  hint,
  value,
  suffix,
  placeholder,
  inputMode,
  onChange,
  controlClassName
}: {
  label: string
  hint?: string
  value: string
  suffix?: string
  placeholder?: string
  inputMode?: 'numeric' | 'text'
  onChange: (value: string) => void
  controlClassName?: string
}) => {
  return (
    <RagFieldRow label={label} hint={hint}>
      <div className={cn('relative', controlClassName ?? 'w-44')}>
        <Input
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          className={cn('shadow-none', suffix ? 'pr-14' : undefined)}
        />
        {suffix ? (
          <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3 text-foreground-muted text-xs leading-4">
            {suffix}
          </span>
        ) : null}
      </div>
    </RagFieldRow>
  )
}

export const RagReadonlyField = ({ label, value, hint }: { label: string; value: string; hint?: string }) => {
  return (
    <div>
      <RagFieldLabel label={label} hint={hint} />
      <Input readOnly value={value} className="shadow-none" />
    </div>
  )
}

export const RagHintText = ({
  children,
  tone = 'info'
}: {
  children: ReactNode
  tone?: 'info' | 'warning' | 'error'
}) => {
  if (tone === 'error') {
    return (
      <div className="rounded-md border border-error-border bg-error-bg px-2.5 py-1.5 text-error-text text-xs leading-4">
        {children}
      </div>
    )
  }

  return <p className="text-foreground-muted text-xs leading-4">{children}</p>
}

export const RagSliderField = ({
  label,
  value,
  onValueChange,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  formatValue,
  hint,
  disabled = false
}: {
  label: string
  value: number
  onValueChange: (value: number) => void
  min: number
  max: number
  step: number
  minLabel: string
  maxLabel: string
  formatValue: (value: number) => string
  hint?: string
  disabled?: boolean
}) => {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <RagFieldLabel label={label} hint={hint} className="mb-0" />
        <span className="text-foreground-secondary text-xs tabular-nums leading-4">{formatValue(value)}</span>
      </div>

      <div className={disabled ? 'opacity-50' : undefined}>
        <Slider
          aria-label={label}
          value={[value]}
          onValueChange={(nextValue) => onValueChange(nextValue[0] ?? min)}
          min={min}
          max={max}
          step={step}
          size="md"
          disabled={disabled}
          className="w-full **:data-[slot=slider-thumb]:border-primary **:data-[slot=slider-range]:bg-primary **:data-[slot=slider-thumb]:bg-background **:data-[slot=slider-track]:bg-muted **:data-[slot=slider-thumb]:shadow-sm"
        />

        <div className="mt-px flex items-center justify-between text-foreground-muted text-xs leading-4">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    </div>
  )
}
