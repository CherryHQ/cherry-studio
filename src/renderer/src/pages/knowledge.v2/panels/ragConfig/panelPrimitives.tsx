import {
  Input,
  NormalTooltip,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider
} from '@cherrystudio/ui'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import { Info, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export const RagSectionTitle = ({ title, icon: Icon }: { title: string; icon: LucideIcon }) => {
  return (
    <div className="flex items-center gap-1.5 pt-1 pb-1.5 font-medium text-[0.75rem] text-foreground leading-4.5">
      <Icon className="size-3.5 text-muted-foreground/70" />
      <span>{title}</span>
    </div>
  )
}

export const RagFieldLabel = ({ label, hint }: { label: string; hint?: string }) => {
  return (
    <div className="mb-1 flex items-center gap-1">
      <span className="text-[0.6875rem] text-foreground/75 leading-4.125">{label}</span>
      {hint ? (
        <NormalTooltip
          content={hint}
          side="top"
          contentProps={{
            className: 'max-w-56 rounded-md px-2.5 py-1.5 text-[0.6875rem] leading-4 text-foreground/75'
          }}>
          <span tabIndex={0} aria-label={hint}>
            <Info className="size-2.25 cursor-help text-muted-foreground/40" />
          </span>
        </NormalTooltip>
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
      <SelectTrigger
        size="sm"
        className="h-auto min-h-0 w-full rounded-md border-border/40 bg-transparent px-2.5 py-1.5 text-[0.6875rem] leading-4.125 shadow-none dark:bg-transparent [&_svg]:size-3.5 [&_svg]:text-muted-foreground/40">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="text-[0.6875rem]">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="text-[0.6875rem]">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export const RagNumericField = ({
  label,
  value,
  suffix,
  hint,
  onChange
}: {
  label: string
  value: string
  suffix?: string
  hint?: string
  onChange: (value: string) => void
}) => {
  return (
    <div>
      <RagFieldLabel label={label} hint={hint} />
      <div className="relative">
        <Input
          value={value}
          inputMode="numeric"
          onChange={(event) => onChange(event.target.value)}
          className="h-auto rounded-md border-border/40 bg-transparent px-2.5 py-1.5 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/30 focus-visible:border-emerald-400/40 focus-visible:ring-1 focus-visible:ring-emerald-400/15 md:text-[0.6875rem]"
        />
        {suffix ? (
          <span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-2.5 text-[0.5625rem] text-muted-foreground/25 leading-3.375">
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export const RagReadonlyField = ({ label, value, hint }: { label: string; value: string; hint?: string }) => {
  return (
    <div>
      <RagFieldLabel label={label} hint={hint} />
      <Input
        readOnly
        value={value}
        className="h-auto rounded-md border-border/40 bg-transparent px-2.5 py-1.5 text-[0.6875rem] text-foreground leading-4.125 shadow-none placeholder:text-muted-foreground/30 focus-visible:border-emerald-400/40 focus-visible:ring-1 focus-visible:ring-emerald-400/15 md:text-[0.6875rem]"
      />
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
  const toneClassNames =
    tone === 'warning'
      ? {
          container: 'border-amber-500/12 bg-amber-500/[0.06]',
          icon: 'text-amber-600/60',
          text: 'text-amber-600/60'
        }
      : tone === 'error'
        ? {
            container: 'border-red-500/15 bg-red-500/[0.06]',
            icon: 'text-red-500/70',
            text: 'text-red-500/75'
          }
        : {
            container: 'border-emerald-400/20 bg-emerald-400/5',
            icon: 'text-emerald-400/70',
            text: 'text-emerald-400/70'
          }

  return (
    <div className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${toneClassNames.container}`}>
      <Info className={`mt-px size-3 shrink-0 ${toneClassNames.icon}`} />
      <div className={`text-[0.5625rem] leading-[0.9141rem] ${toneClassNames.text}`}>{children}</div>
    </div>
  )
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
      <div className="mb-1 flex items-end justify-between gap-3">
        <RagFieldLabel label={label} hint={hint} />
        <span className="text-[0.6875rem] text-foreground leading-4.125">{formatValue(value)}</span>
      </div>

      <div className={disabled ? 'opacity-50' : undefined}>
        <Slider
          aria-label={label}
          value={[value]}
          onValueChange={(nextValue) => onValueChange(nextValue[0] ?? min)}
          min={min}
          max={max}
          step={step}
          size="sm"
          disabled={disabled}
          className="w-full **:data-[slot=slider-thumb]:size-2.5 **:data-[slot=slider-track]:h-px **:data-[slot=slider-thumb]:border-foreground/20 **:data-[slot=slider-range]:bg-foreground/65 **:data-[slot=slider-thumb]:bg-background **:data-[slot=slider-track]:bg-border/40 **:data-[slot=slider-thumb]:shadow-none"
        />

        <div className="mt-px flex items-center justify-between text-[0.5rem] text-muted-foreground/25 leading-3">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    </div>
  )
}
