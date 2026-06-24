import {
  ColorPicker,
  ColorPickerEyeDropper,
  ColorPickerHue,
  ColorPickerSelection,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex
} from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const SHORT_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{3}$/

export const normalizeHexColor = (value: string) => {
  let normalized = value.trim()

  if (!normalized) {
    return null
  }

  if (!normalized.startsWith('#')) {
    normalized = `#${normalized}`
  }

  if (SHORT_HEX_COLOR_PATTERN.test(normalized)) {
    normalized = `#${normalized
      .slice(1)
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`
  }

  if (!HEX_COLOR_PATTERN.test(normalized)) {
    return null
  }

  return normalized.toUpperCase()
}

interface ThemeColorPickerProps {
  value: string
  presets: readonly string[]
  onChange: (value: string) => void
  ariaLabel: string
  className?: string
}

const ThemeColorPicker = ({ value, presets, onChange, ariaLabel, className }: ThemeColorPickerProps) => {
  const normalizedValue = normalizeHexColor(value) ?? '#000000'
  const [draftValue, setDraftValue] = useState(normalizedValue)
  const isCustomValue = !presets.some((color) => (normalizeHexColor(color) ?? color) === normalizedValue)
  // ColorPicker fires onChange once on mount with its seeded value; skip that one so
  // merely opening the popover doesn't commit a round-tripped (possibly drifted) color.
  const skipInitialPick = useRef(true)

  useEffect(() => {
    setDraftValue(normalizedValue)
  }, [normalizedValue])

  const commitColor = (nextValue: string) => {
    setDraftValue(nextValue)

    const nextColor = normalizeHexColor(nextValue)
    if (nextColor && nextColor !== normalizedValue) {
      onChange(nextColor)
    }
  }

  const handlePickerChange = ([r, g, b]: [number, number, number, number]) => {
    if (skipInitialPick.current) {
      skipInitialPick.current = false
      return
    }

    const hex = `#${[r, g, b]
      .map((channel) =>
        Math.max(0, Math.min(255, Math.round(channel)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`
    commitColor(hex)
  }

  return (
    <RowFlex className={cn('min-w-0 max-w-full flex-wrap items-center gap-3.5', className)}>
      <RowFlex className="min-w-0 max-w-full flex-wrap items-center gap-3">
        {presets.map((color) => {
          const normalizedPreset = normalizeHexColor(color) ?? color
          const selected = normalizedPreset === normalizedValue

          return (
            <button
              key={color}
              type="button"
              aria-label={normalizedPreset}
              aria-pressed={selected}
              className={cn(
                'size-5 rounded-full outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                selected && 'ring-(--dot-color) ring-2 ring-offset-2 ring-offset-background'
              )}
              style={{ backgroundColor: normalizedPreset, '--dot-color': normalizedPreset } as CSSProperties}
              onClick={() => commitColor(normalizedPreset)}
            />
          )
        })}
        <Popover
          onOpenChange={(open) => {
            if (open) {
              skipInitialPick.current = true
            }
          }}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={ariaLabel}
              className={cn(
                'relative size-5 shrink-0 cursor-pointer rounded-full outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isCustomValue && 'ring-(--dot-color) ring-2 ring-offset-2 ring-offset-background'
              )}
              style={
                {
                  background:
                    'conic-gradient(from 180deg, #E5484D, #F76B15, #FFC53D, #30A46C, #0091FF, #8E4EC6, #E5484D)',
                  '--dot-color': normalizedValue
                } as CSSProperties
              }
            />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-3">
            <ColorPicker defaultValue={normalizedValue} onChange={handlePickerChange} className="gap-3">
              <ColorPickerSelection className="h-40 w-full rounded-lg" />
              <RowFlex className="items-center gap-2">
                <ColorPickerEyeDropper size="icon-sm" />
                <ColorPickerHue className="flex-1" />
              </RowFlex>
            </ColorPicker>
          </PopoverContent>
        </Popover>
      </RowFlex>
      <Input
        value={draftValue}
        onChange={(event) => commitColor(event.target.value)}
        onBlur={() => setDraftValue(normalizedValue)}
        className="h-7 w-22 font-mono text-xs uppercase"
        spellCheck={false}
      />
    </RowFlex>
  )
}

export default ThemeColorPicker
