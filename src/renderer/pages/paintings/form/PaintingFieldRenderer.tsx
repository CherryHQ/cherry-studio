import { alignRangeValue } from '@cherrystudio/provider-registry'
import { Button, Input, RadioGroup, RadioGroupItem, Slider, Switch, Textarea, Tooltip } from '@cherrystudio/ui'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { fieldRegistry } from './fieldRegistry'
import { resolveOptions } from './resolveOptions'

/** Compact enough for the 300px params popover; wide enough for values like `20.0`. */
const RANGE_VALUE_INPUT_CLASS =
  'h-8 min-h-8 w-14 shrink-0 px-1.5 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export type { BaseConfigItem, OptionItem } from '../form/baseConfigItem'

export interface PaintingFieldRendererProps {
  item: BaseConfigItem
  painting: Record<string, unknown>
  onChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
}

export function PaintingFieldRenderer({ item, painting, onChange, onGenerateRandomSeed }: PaintingFieldRendererProps) {
  const { t } = useTranslation()
  const fieldKey = item.key
  if (!fieldKey) {
    return null
  }

  const disabled = typeof item.disabled === 'function' ? item.disabled(item, painting) : item.disabled
  const currentValue = painting[fieldKey] ?? item.initialValue
  const RegisteredField = fieldRegistry[item.type]

  if (RegisteredField) {
    return (
      <RegisteredField
        item={item}
        fieldKey={fieldKey}
        painting={painting}
        translate={t}
        onChange={onChange}
        onGenerateRandomSeed={onGenerateRandomSeed}
        currentValue={currentValue}
        disabled={disabled}
      />
    )
  }

  switch (item.type) {
    case 'radio': {
      const options = resolveOptions(item, painting, t)
      const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''

      return (
        <RadioGroup
          value={value}
          className="flex flex-wrap gap-3"
          onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}>
          {options.map((option) => {
            const optionValue = String(option.value)
            const inputId = `${fieldKey}-${optionValue}`
            return (
              <label key={optionValue} htmlFor={inputId} className="flex cursor-pointer items-center gap-2 text-sm">
                <RadioGroupItem id={inputId} value={optionValue} />
                <span>{option.label}</span>
              </label>
            )
          })}
        </RadioGroup>
      )
    }

    case 'slider': {
      const numericValue = Number(currentValue ?? item.min ?? 0)
      const min = item.min ?? 0
      const max = item.max ?? 100
      // Degenerate single-value range (e.g. numImages 1..1): the slider has
      // nowhere to move and Radix renders its thumb flush to the rail edge,
      // which the parent's `overflow-hidden` clips. Skip the slider and show
      // a read-only number input instead.
      if (min === max) {
        return (
          <Input className={RANGE_VALUE_INPUT_CLASS} type="number" value={String(numericValue)} readOnly disabled />
        )
      }
      const snapStep = typeof item.step === 'number' && item.step > 0 ? item.step : undefined
      const commitRange = (raw: number) => {
        const next =
          snapStep === undefined ? Math.min(max, Math.max(min, raw)) : alignRangeValue(raw, min, max, snapStep)
        onChange({ [fieldKey]: next })
      }
      return (
        <div className="flex min-w-0 items-center gap-3">
          <Slider
            className="min-w-0 flex-1"
            min={min}
            max={max}
            step={item.step ?? 1}
            value={[numericValue]}
            onValueChange={(values) => {
              const next = values[0]
              if (next === undefined) return
              commitRange(next)
            }}
          />
          <Input
            className={RANGE_VALUE_INPUT_CLASS}
            type="number"
            min={min}
            max={max}
            step={item.step}
            value={String(numericValue)}
            onChange={(event) => {
              const raw = event.target.value
              // Ignore the transient empty state (clearing to retype). Snap only
              // when the spec declared a step; otherwise clamp and keep decimals.
              if (raw === '') return
              const parsed = Number(raw)
              if (Number.isNaN(parsed)) return
              commitRange(parsed)
            }}
          />
        </div>
      )
    }

    case 'input': {
      const showSeedReset = fieldKey.toLowerCase().includes('seed') && Boolean(onGenerateRandomSeed)
      const seedResetLabel = t('common.regenerate')
      return (
        <div className={showSeedReset ? 'flex h-8 items-center gap-2' : 'flex items-center gap-2'}>
          <Input
            disabled={disabled}
            className={showSeedReset ? 'h-8 min-h-8 flex-1' : 'flex-1'}
            value={currentValue === undefined || currentValue === null ? '' : String(currentValue)}
            onChange={(event) => onChange({ [fieldKey]: event.target.value })}
          />
          {showSeedReset ? (
            <Tooltip
              content={seedResetLabel}
              placement="top"
              classNames={{ placeholder: 'inline-flex h-8 w-8 shrink-0' }}>
              <Button
                type="button"
                variant="outline"
                className="h-8 min-h-8 w-8 min-w-8 shrink-0 p-0"
                aria-label={seedResetLabel}
                onClick={() => onGenerateRandomSeed?.(fieldKey)}>
                <RotateCcw size={14} />
              </Button>
            </Tooltip>
          ) : null}
        </div>
      )
    }

    case 'textarea': {
      return (
        <Textarea.Input
          value={currentValue === undefined || currentValue === null ? '' : String(currentValue)}
          rows={4}
          onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}
        />
      )
    }

    case 'switch': {
      return (
        <Switch
          className="shrink-0"
          checked={Boolean(currentValue)}
          disabled={disabled}
          aria-label={item.title ? t(item.title) : fieldKey}
          onCheckedChange={(checked) => onChange({ [fieldKey]: checked })}
        />
      )
    }

    case 'iconRadio': {
      const options = resolveOptions(item, painting, t)
      const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''
      const columns = item.columns || 3

      return (
        <RadioGroup
          value={value}
          aria-label={item.title ? t(item.title) : fieldKey}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}>
          {options.map((option) => (
            <label
              key={String(option.value)}
              htmlFor={`${fieldKey}-${option.value}`}
              className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] px-2 py-1.5 text-[11px] transition-all ${
                value === String(option.value)
                  ? 'bg-secondary-active text-foreground ring-1 ring-[color:color-mix(in_oklch,var(--foreground)_33.3333%,transparent)]'
                  : 'bg-muted text-foreground-tertiary hover:bg-secondary-hover hover:text-foreground'
              }`}>
              <RadioGroupItem value={String(option.value)} id={`${fieldKey}-${option.value}`} className="sr-only" />
              {option.icon && (
                <div className="flex items-center justify-center bg-transparent" aria-hidden>
                  <span
                    className={`h-3 w-3 bg-current transition-opacity ${value === String(option.value) ? 'opacity-100' : 'opacity-60'}`}
                    style={{
                      mask: `url(${option.icon}) center / contain no-repeat`,
                      WebkitMask: `url(${option.icon}) center / contain no-repeat`
                    }}
                  />
                </div>
              )}
              <span className="font-medium tracking-tight">{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      )
    }

    case 'styleToggle': {
      const options = resolveOptions(item, painting, t)
      const { toggleMode = 'single' } = item

      return (
        <div className="flex flex-wrap items-start gap-2">
          {options.map((option) => (
            <button
              type="button"
              key={String(option.value)}
              className={`rounded-[6px] border px-[6px] py-[2px] transition-all ${
                currentValue === String(option.value)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-accent'
              }`}
              onClick={() => {
                if (toggleMode === 'single' && currentValue === String(option.value)) {
                  onChange({ [fieldKey]: '' })
                } else {
                  onChange({ [fieldKey]: String(option.value) })
                }
              }}>
              {option.label}
            </button>
          ))}
        </div>
      )
    }

    default:
      return null
  }
}
