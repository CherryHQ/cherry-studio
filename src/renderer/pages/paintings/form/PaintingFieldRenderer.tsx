import { alignRangeValue } from '@cherrystudio/provider-registry'
import { Button, Input, RadioGroup, RadioGroupItem, Slider, Switch, Textarea, Tooltip } from '@cherrystudio/ui'
import { RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type BaseConfigItem, isOptionsConfigItem } from '../form/baseConfigItem'
import { fieldRegistry } from './fieldRegistry'
import { booleanOr, controlValue, finiteParamNumberOr, stringOr } from './fieldValue'
import { resolveOptions, resolveOptionValue } from './resolveOptions'

/** Compact enough for the 300px params popover; wide enough for values like `16.5`. */
const RANGE_VALUE_INPUT_CLASS =
  'h-8 min-h-8 w-12 shrink-0 px-1.5 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

export type { BaseConfigItem, OptionItem } from '../form/baseConfigItem'

/** Optional sign, one dot, digits — anything else is rejected so letters never stick. */
function isAllowedRangeDraft(raw: string): boolean {
  return /^-?\d*\.?\d*$/.test(raw)
}

/** Empty, sign, trailing decimal, or trailing-zero fraction so the next digit can still be typed. */
function isTransientRangeDraft(raw: string): boolean {
  return raw === '' || raw === '-' || /^-?\d*\.$/.test(raw) || /^-?\d+\.\d*0$/.test(raw)
}

function parseRangeDraft(raw: string): number | null {
  if (raw.trim() === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function PaintingRangeField({
  fieldKey,
  label,
  min,
  max,
  step,
  numericValue,
  onChange
}: {
  fieldKey: string
  label: string
  min: number
  max: number
  step?: number
  numericValue: number
  onChange: (updates: Record<string, unknown>) => void
}) {
  const snapStep = typeof step === 'number' && step > 0 ? step : undefined
  const [draft, setDraft] = useState<string | null>(null)
  const lastPushedRef = useRef(numericValue)

  const commitRange = (raw: number) => {
    const next = snapStep === undefined ? Math.min(max, Math.max(min, raw)) : alignRangeValue(raw, min, max, snapStep)
    lastPushedRef.current = next
    onChange({ [fieldKey]: next })
    return next
  }

  const nudge = (direction: 1 | -1) => {
    const parsed = parseRangeDraft(draft ?? '')
    const base = parsed ?? numericValue
    const committed = commitRange(base + (snapStep ?? 1) * direction)
    setDraft(String(committed))
  }

  useEffect(() => {
    if (numericValue === lastPushedRef.current) return
    lastPushedRef.current = numericValue
    setDraft((current) => (current === null ? current : String(numericValue)))
  }, [numericValue])

  const ariaValueNow = draft === null ? numericValue : (parseRangeDraft(draft) ?? undefined)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <Slider
        aria-label={label}
        className="min-w-0 flex-1"
        min={min}
        max={max}
        step={step ?? 1}
        value={[numericValue]}
        onValueChange={(values) => {
          const next = values[0]
          if (next === undefined) return
          const committed = commitRange(next)
          setDraft((current) => (current === null ? current : String(committed)))
        }}
      />
      <Input
        aria-label={label}
        className={RANGE_VALUE_INPUT_CLASS}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={ariaValueNow}
        value={draft ?? String(numericValue)}
        onFocus={() => {
          setDraft((current) => current ?? String(numericValue))
        }}
        onChange={(event) => {
          const raw = event.target.value
          if (!isAllowedRangeDraft(raw)) return
          setDraft(raw)
          if (isTransientRangeDraft(raw)) return
          const parsed = parseRangeDraft(raw)
          if (parsed === null) return
          setDraft(String(commitRange(parsed)))
        }}
        onBlur={() => {
          if (draft !== null) {
            const parsed = parseRangeDraft(draft)
            if (parsed !== null) commitRange(parsed)
          }
          setDraft(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            nudge(1)
          } else if (event.key === 'ArrowDown') {
            event.preventDefault()
            nudge(-1)
          }
        }}
      />
    </div>
  )
}

export interface PaintingFieldRendererProps {
  item: BaseConfigItem
  painting: Record<string, unknown>
  onChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
}

export function PaintingFieldRenderer({ item, painting, onChange, onGenerateRandomSeed }: PaintingFieldRendererProps) {
  const { t } = useTranslation()
  const fieldKey = item.key

  const disabled = typeof item.disabled === 'function' ? item.disabled(item, painting) : item.disabled
  const currentValue = isOptionsConfigItem(item)
    ? resolveOptionValue(item, painting[fieldKey], painting, t)
    : (painting[fieldKey] ?? item.initialValue)

  switch (item.type) {
    case 'select': {
      const RegisteredField = fieldRegistry.select
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

    case 'sizeChips': {
      const RegisteredField = fieldRegistry.sizeChips
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

    case 'customSize': {
      const RegisteredField = fieldRegistry.customSize
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

    case 'radio': {
      const options = resolveOptions(item, painting, t)
      const value = controlValue(currentValue)

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
      const numericValue = finiteParamNumberOr(item.key, currentValue, item.initialValue)
      const { min, max } = item
      const label = item.title ? t(item.title) : fieldKey
      // Degenerate single-value range (e.g. numImages 1..1): the slider has
      // nowhere to move and Radix renders its thumb flush to the rail edge,
      // which the parent's `overflow-hidden` clips. Skip the slider and show
      // a read-only number input instead.
      if (min === max) {
        return (
          <Input
            aria-label={label}
            className={RANGE_VALUE_INPUT_CLASS}
            type="number"
            value={String(numericValue)}
            readOnly
            disabled
          />
        )
      }
      return (
        <PaintingRangeField
          fieldKey={fieldKey}
          label={label}
          min={min}
          max={max}
          step={item.step}
          numericValue={numericValue}
          onChange={onChange}
        />
      )
    }

    case 'input': {
      const showSeedReset = fieldKey.toLowerCase().includes('seed') && Boolean(onGenerateRandomSeed)
      const seedResetLabel = t('common.regenerate')
      const value = stringOr(currentValue, item.initialValue)
      return (
        <div className={showSeedReset ? 'flex h-8 items-center gap-2' : 'flex items-center gap-2'}>
          <Input
            disabled={disabled}
            className={showSeedReset ? 'h-8 min-h-8 flex-1' : 'flex-1'}
            value={value}
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
      const value = stringOr(currentValue, item.initialValue)
      return (
        <Textarea.Input value={value} rows={4} onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })} />
      )
    }

    case 'switch': {
      const checked = booleanOr(currentValue, item.initialValue)
      return (
        <Switch
          className="shrink-0"
          checked={checked}
          disabled={disabled}
          aria-label={item.title ? t(item.title) : fieldKey}
          onCheckedChange={(checked) => onChange({ [fieldKey]: checked })}
        />
      )
    }

    case 'iconRadio': {
      const options = resolveOptions(item, painting, t)
      const value = controlValue(currentValue)
      const columns = item.columns ?? 3

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
      const value = stringOr(currentValue, item.initialValue)

      return (
        <div className="flex flex-wrap items-start gap-2">
          {options.map((option) => (
            <button
              type="button"
              key={String(option.value)}
              className={`rounded-[6px] border px-[6px] py-[2px] transition-all ${
                value === String(option.value)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background hover:bg-accent'
              }`}
              onClick={() => {
                if (toggleMode === 'single' && value === String(option.value)) {
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
