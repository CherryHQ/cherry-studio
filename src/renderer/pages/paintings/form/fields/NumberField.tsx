import { Input } from '@cherrystudio/ui'

import type { PaintingFieldComponentProps } from '../fieldRegistry'

export default function NumberField({ item, fieldKey, onChange, currentValue, disabled }: PaintingFieldComponentProps) {
  return (
    <Input
      disabled={disabled}
      type="number"
      min={item.min}
      max={item.max}
      step={item.step}
      value={currentValue === undefined || currentValue === null ? '' : String(currentValue)}
      onChange={(event) => onChange({ [fieldKey]: event.target.value === '' ? undefined : Number(event.target.value) })}
    />
  )
}
