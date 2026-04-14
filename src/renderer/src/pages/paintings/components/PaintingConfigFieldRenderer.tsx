import {
  Button,
  Input,
  RadioGroup,
  RadioGroupItem,
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

type PrimitiveValue = string | number | boolean | undefined

type OptionItem = {
  label?: string
  labelKey?: string
  title?: string
  value?: string | number
  icon?: string
  options?: OptionItem[]
}

type BaseConfigItem = {
  type: 'select' | 'radio' | 'slider' | 'input' | 'switch' | 'inputNumber' | 'textarea' | 'image'
  key?: string
  title?: string
  tooltip?: string
  options?: OptionItem[] | ((config: BaseConfigItem, painting: Record<string, unknown>) => OptionItem[])
  min?: number
  max?: number
  step?: number
  initialValue?: PrimitiveValue
  disabled?: boolean | ((config: BaseConfigItem, painting: Record<string, unknown>) => boolean)
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
        <label className="flex min-h-32 cursor-pointer items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-3 hover:bg-muted/30">
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
            (imagePlaceholder ?? <span className="text-sm text-muted-foreground">Upload image</span>)
          )}
        </label>
      )
    }

    default:
      return null
  }
}
