import { Input, RowFlex } from '@cherrystudio/ui'

import type { PaintingFieldComponentProps } from '../fieldRegistry'

function buildSizeValue(width: unknown, height: unknown, fallback: unknown): unknown {
  if (width === '' || height === '' || width === undefined || height === undefined) {
    return fallback
  }
  return `${width}x${height}`
}

export default function SizeField({ item, painting, onChange }: PaintingFieldComponentProps) {
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
          onChange={(event) => {
            const value = event.target.value === '' ? '' : Number(event.target.value)
            const updates: Record<string, unknown> = { [widthKey]: value }
            if (sizeKey) {
              updates[sizeKey] = buildSizeValue(value, heightValue, painting[sizeKey])
            }
            onChange(updates)
          }}
          min={validation.minWidth}
          max={validation.maxWidth}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground">x</span>
        <Input
          placeholder="H"
          type="number"
          value={heightValue === undefined || heightValue === null ? '' : String(heightValue)}
          onChange={(event) => {
            const value = event.target.value === '' ? '' : Number(event.target.value)
            const updates: Record<string, unknown> = { [heightKey]: value }
            if (sizeKey) {
              updates[sizeKey] = buildSizeValue(widthValue, value, painting[sizeKey])
            }
            onChange(updates)
          }}
          min={validation.minHeight}
          max={validation.maxHeight}
          className="flex-1"
        />
        <span className="text-xs text-muted-foreground">px</span>
      </RowFlex>
    </div>
  )
}
