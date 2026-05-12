import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'

import type { OptionItem } from '../../providers/shared/providerFieldSchema'
import type { PaintingFieldComponentProps } from '../fieldRegistry'

function mapOptions(
  itemOptions: PaintingFieldComponentProps['item']['options'],
  item: PaintingFieldComponentProps['item'],
  painting: Record<string, unknown>,
  translate: (key: string) => string
): OptionItem[] {
  const rawOptions = typeof itemOptions === 'function' ? itemOptions(item, painting) : (itemOptions ?? [])

  return rawOptions.map((option) => ({
    ...option,
    label: option.labelKey ? translate(option.labelKey) : option.label
  }))
}

export default function SelectField({
  item,
  fieldKey,
  painting,
  translate,
  onChange,
  currentValue,
  disabled
}: PaintingFieldComponentProps) {
  const options = mapOptions(item.options, item, painting, translate)
  const grouped = options.some((option) => Array.isArray(option.options) && option.options.length > 0)
  const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''

  return (
    <Select disabled={disabled} value={value} onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}>
      <SelectTrigger className="h-auto w-full justify-between gap-2 rounded-(--painting-radius-track) bg-(--painting-control-bg) px-2.5 py-1.5 text-xs hover:bg-(--painting-control-bg-hover)">
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
