import { Button, Input, RadioGroup, RadioGroupItem, Slider, Switch, Textarea } from '@cherrystudio/ui'
import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BaseConfigItem, OptionItem } from '../providers/shared/providerFieldSchema'
import { fieldRegistry } from './fieldRegistry'

export type { BaseConfigItem, OptionItem } from '../providers/shared/providerFieldSchema'

export interface PaintingFieldRendererProps {
  item: BaseConfigItem
  painting: Record<string, unknown>
  onChange: (updates: Record<string, unknown>) => void
  onGenerateRandomSeed?: (key: string) => void
  onImageUpload?: (key: string, file: File) => void
  imagePreviewSrc?: string
  imagePlaceholder?: React.ReactNode
}

function mapOptions(
  item: BaseConfigItem,
  painting: Record<string, unknown>,
  translate: (key: string) => string
): OptionItem[] {
  const rawOptions = typeof item.options === 'function' ? item.options(item, painting) : (item.options ?? [])

  return rawOptions.map((option) => ({
    ...option,
    label: option.labelKey ? translate(option.labelKey) : option.label
  }))
}

export function PaintingFieldRenderer({
  item,
  painting,
  onChange,
  onGenerateRandomSeed,
  onImageUpload,
  imagePreviewSrc,
  imagePlaceholder
}: PaintingFieldRendererProps) {
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
        onImageUpload={onImageUpload}
        imagePreviewSrc={imagePreviewSrc}
        imagePlaceholder={imagePlaceholder}
        currentValue={currentValue}
        disabled={disabled}
      />
    )
  }

  switch (item.type) {
    case 'radio': {
      const options = mapOptions(item, painting, t)
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
      return (
        <div className="flex items-center gap-3">
          <Slider
            className="flex-1"
            min={item.min ?? 0}
            max={item.max ?? 100}
            step={item.step ?? 1}
            value={[numericValue]}
            onValueChange={(values) => onChange({ [fieldKey]: values[0] })}
          />
          <Input
            className="w-20"
            type="number"
            min={item.min}
            max={item.max}
            step={item.step}
            value={String(numericValue)}
            onChange={(event) => onChange({ [fieldKey]: Number(event.target.value) })}
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
      const options = mapOptions(item, painting, t)
      const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''
      const columns = item.columns || 3

      return (
        <RadioGroup
          value={value}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}>
          {options.map((option) => (
            <label
              key={String(option.value)}
              htmlFor={`${fieldKey}-${option.value}`}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-[0.75rem] border px-2 py-1.5 text-[11px] transition-all ${
                value === String(option.value)
                  ? 'border-primary bg-primary/5 text-primary'
                  : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}>
              <RadioGroupItem value={String(option.value)} id={`${fieldKey}-${option.value}`} className="sr-only" />
              {option.icon && (
                <div className="flex items-center justify-center bg-transparent">
                  <img
                    src={option.icon}
                    alt={option.label}
                    className={`h-3 w-3 transition-opacity ${value === String(option.value) ? 'opacity-100' : 'opacity-60'}`}
                  />
                </div>
              )}
              <span className="mt-0.5 font-medium tracking-tight">{option.label}</span>
            </label>
          ))}
        </RadioGroup>
      )
    }

    case 'styleToggle': {
      const options = mapOptions(item, painting, t)
      const { toggleMode = 'single' } = item

      return (
        <div className="flex flex-wrap items-start gap-2">
          {options.map((option) => (
            <button
              type="button"
              key={String(option.value)}
              className={`rounded-[6px] border px-[6px] py-[2px] transition-all ${
                currentValue === String(option.value)
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                  : 'border-[var(--color-border)] bg-[var(--color-background)] hover:bg-[var(--color-hover,#f0f0f0)]'
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
