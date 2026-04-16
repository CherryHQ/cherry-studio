import {
  Button,
  Input,
  RadioGroup,
  RadioGroupItem,
  RowFlex,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Slider,
  Switch,
  Textarea
} from '@cherrystudio/ui'
import { RotateCcw } from 'lucide-react'

import { DynamicFormRender } from './DynamicFormRender'

type PrimitiveValue = string | number | boolean | undefined

export type OptionItem = {
  label?: string
  labelKey?: string
  title?: string
  value?: string | number
  icon?: string
  options?: OptionItem[]
}

export type BaseConfigItem = {
  type:
    | 'select'
    | 'radio'
    | 'slider'
    | 'input'
    | 'switch'
    | 'inputNumber'
    | 'textarea'
    | 'image'
    | 'customSize'
    | 'iconRadio'
    | 'styleToggle'
    | 'dynamicSchema'
  key?: string
  title?: string
  tooltip?: string
  options?: OptionItem[] | ((config: BaseConfigItem, painting: Record<string, unknown>) => OptionItem[])
  min?: number
  max?: number
  step?: number
  initialValue?: PrimitiveValue
  disabled?: boolean | ((config: BaseConfigItem, painting: Record<string, unknown>) => boolean)
  condition?: (painting: Record<string, unknown>) => boolean
  widthKey?: string
  heightKey?: string
  sizeKey?: string
  validation?: {
    minWidth?: number
    maxWidth?: number
    minHeight?: number
    maxHeight?: number
    divisibleBy?: number
    maxPixels?: number
  }
  columns?: number
  toggleMode?: 'single' | 'multi'
  schema?: Record<string, any>
  schemaReader?: (property: Record<string, any>, key: string) => string
}

interface PaintingConfigFieldRendererProps {
  item: BaseConfigItem
  painting: Record<string, unknown>
  translate: (key: string) => string
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

export function PaintingConfigFieldRenderer({
  item,
  painting,
  translate,
  onChange,
  onGenerateRandomSeed,
  onImageUpload,
  imagePreviewSrc,
  imagePlaceholder
}: PaintingConfigFieldRendererProps) {
  const fieldKey = item.key
  if (!fieldKey) {
    return null
  }

  const disabled = typeof item.disabled === 'function' ? item.disabled(item, painting) : item.disabled
  const currentValue = painting[fieldKey] ?? item.initialValue

  switch (item.type) {
    case 'select': {
      const options = mapOptions(item, painting, translate)
      const grouped = options.some((option) => Array.isArray(option.options) && option.options.length > 0)
      const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''

      return (
        <Select disabled={disabled} value={value} onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={item.title ? translate(item.title) : fieldKey} />
          </SelectTrigger>
          <SelectContent>
            {grouped
              ? options.map((group) => (
                  <SelectGroup key={group.title || group.label}>
                    <SelectLabel>{group.label || group.title}</SelectLabel>
                    {group.options?.map((option) => (
                      <SelectItem key={`${fieldKey}-${option.value}`} value={String(option.value)}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))
              : options.map((option) => (
                  <SelectItem key={`${fieldKey}-${option.value}`} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      )
    }

    case 'radio': {
      const options = mapOptions(item, painting, translate)
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
            onChange={(e) => onChange({ [fieldKey]: Number(e.target.value) })}
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
            onChange={(e) => onChange({ [fieldKey]: e.target.value })}
          />
          {fieldKey.toLowerCase().includes('seed') && onGenerateRandomSeed ? (
            <Button type="button" size="icon-sm" variant="outline" onClick={() => onGenerateRandomSeed(fieldKey)}>
              <RotateCcw size={14} />
            </Button>
          ) : null}
        </div>
      )
    }

    case 'inputNumber': {
      return (
        <Input
          disabled={disabled}
          type="number"
          min={item.min}
          max={item.max}
          step={item.step}
          value={currentValue === undefined || currentValue === null ? '' : String(currentValue)}
          onChange={(e) => onChange({ [fieldKey]: e.target.value === '' ? undefined : Number(e.target.value) })}
        />
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

    case 'image': {
      return (
        <label className="flex min-h-32 cursor-pointer items-center justify-center rounded-md border border-border border-dashed bg-muted/20 p-3 hover:bg-muted/30">
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file && onImageUpload) {
                onImageUpload(fieldKey, file)
              }
              event.target.value = ''
            }}
          />
          {imagePreviewSrc ? (
            <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-md">
              <img src={imagePreviewSrc} alt="preview" className="max-h-32 object-contain" />
            </div>
          ) : (
            (imagePlaceholder ?? <span className="text-muted-foreground text-sm">Upload image</span>)
          )}
        </label>
      )
    }

    case 'customSize': {
      const { widthKey = 'width', heightKey = 'height', sizeKey, validation = {} } = item
      const widthValue = painting[widthKey] ?? ''
      const heightValue = painting[heightKey] ?? ''

      return (
        <div className="flex flex-col gap-2">
          <RowFlex className="items-center gap-2">
            <Input
              placeholder="W"
              type="number"
              value={widthValue === undefined || widthValue === null ? '' : String(widthValue)}
              onChange={(e) => {
                const value = e.target.value === '' ? '' : Number(e.target.value)
                const updates: Record<string, unknown> = { [widthKey]: value }
                if (sizeKey) {
                  updates[sizeKey] = `${value}x${heightValue}`
                }
                onChange(updates)
              }}
              min={validation.minWidth}
              max={validation.maxWidth}
              className="flex-1"
            />
            <span className="text-[12px] text-[var(--color-text-2)]">x</span>
            <Input
              placeholder="H"
              type="number"
              value={heightValue === undefined || heightValue === null ? '' : String(heightValue)}
              onChange={(e) => {
                const value = e.target.value === '' ? '' : Number(e.target.value)
                const updates: Record<string, unknown> = { [heightKey]: value }
                if (sizeKey) {
                  updates[sizeKey] = `${widthValue}x${value}`
                }
                onChange(updates)
              }}
              min={validation.minHeight}
              max={validation.maxHeight}
              className="flex-1"
            />
            <span className="text-[12px] text-[var(--color-text-2)]">px</span>
          </RowFlex>
        </div>
      )
    }

    case 'iconRadio': {
      const options = mapOptions(item, painting, translate)
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
      const options = mapOptions(item, painting, translate)
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

    case 'dynamicSchema': {
      return (
        <div className="flex flex-col gap-3">
          {item.schema &&
            Object.entries(item.schema).map(([propKey, property]: [string, any]) => {
              if (propKey === 'prompt') return null
              return (
                <div key={propKey} className="flex flex-col">
                  <div className="mb-1.5 flex items-center">
                    <span className="font-medium text-[13px] capitalize">
                      {item.schemaReader ? item.schemaReader(property, 'title') : property.title || propKey}
                    </span>
                  </div>
                  <DynamicFormRender
                    schemaProperty={property}
                    propertyName={propKey}
                    value={painting[propKey]}
                    onChange={(field, value) => onChange({ [field]: value })}
                  />
                </div>
              )
            })}
        </div>
      )
    }

    default:
      return null
  }
}
