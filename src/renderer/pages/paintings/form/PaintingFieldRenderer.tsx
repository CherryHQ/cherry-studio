import { Button, Input, RadioGroup, RadioGroupItem, Slider, Switch, Textarea } from '@cherrystudio/ui'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem } from '../form/baseConfigItem'
import { fieldRegistry } from './fieldRegistry'
import { resolveOptions } from './resolveOptions'

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
        return <Input className="w-20" type="number" value={String(numericValue)} readOnly disabled />
      }
      return (
        <div className="flex items-center gap-3">
          <Slider
            className="flex-1"
            min={min}
            max={max}
            step={item.step ?? 1}
            value={[numericValue]}
            onValueChange={(values) => onChange({ [fieldKey]: values[0] })}
          />
          <Input
            className="w-20"
            type="number"
            min={min}
            max={max}
            step={item.step}
            value={String(numericValue)}
            onChange={(event) => {
              const raw = event.target.value
              // Ignore the transient empty state (clearing to retype) — committing
              // `Number('')` → 0 would drop below `min`. Otherwise clamp to [min,max]
              // so the controlled value never escapes the field's range.
              if (raw === '') return
              const parsed = Number(raw)
              if (Number.isNaN(parsed)) return
              onChange({ [fieldKey]: Math.min(max, Math.max(min, parsed)) })
            }}
          />
        </div>
      )
    }

    case 'input': {
      return (
        <div className="flex items-center gap-2">
          <Input
            disabled={disabled}
            className="flex-1"
            value={currentValue === undefined || currentValue === null ? '' : String(currentValue)}
            onChange={(event) => onChange({ [fieldKey]: event.target.value })}
          />
          {fieldKey.toLowerCase().includes('seed') && onGenerateRandomSeed ? (
            <Button type="button" size="icon-sm" variant="outline" onClick={() => onGenerateRandomSeed(fieldKey)}>
              <RotateCcw size={14} />
            </Button>
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
        <div className="flex items-center">
          <Switch checked={Boolean(currentValue)} onCheckedChange={(checked) => onChange({ [fieldKey]: checked })} />
        </div>
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
                  ? 'bg-secondary-active text-foreground ring-1 ring-[var(--color-border-active)]'
                  : 'bg-muted text-muted-foreground/60 hover:bg-secondary-hover hover:text-foreground'
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
