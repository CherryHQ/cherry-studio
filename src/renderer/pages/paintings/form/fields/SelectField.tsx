import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'

import type { PaintingFieldComponentProps } from '../fieldRegistry'
import { resolveOptions } from '../resolveOptions'

export default function SelectField({
  item,
  fieldKey,
  painting,
  translate,
  onChange,
  currentValue,
  disabled
}: PaintingFieldComponentProps) {
  const options = resolveOptions(item, painting, translate)
  const grouped = options.some((option) => Array.isArray(option.options) && option.options.length > 0)
  const value = currentValue !== undefined && currentValue !== null ? String(currentValue) : ''

  return (
    <Select disabled={disabled} value={value} onValueChange={(nextValue) => onChange({ [fieldKey]: nextValue })}>
      <SelectTrigger
        aria-label={item.title ? translate(item.title) : fieldKey}
        className="h-auto w-full justify-between gap-2 rounded-[8px] bg-secondary px-2.5 py-1.5 text-xs hover:bg-secondary-hover">
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
