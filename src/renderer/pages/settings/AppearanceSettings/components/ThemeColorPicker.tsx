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
import { useEffect, useState } from 'react'

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

  useEffect(() => {
    setDraftValue(normalizedValue)
  }, [normalizedValue])

  const commitColor = (nextValue: string) => {
    setDraftValue(nextValue)

    const nextColor = normalizeHexColor(nextValue)
    if (nextColor) {
      onChange(nextColor)
    }
  }

  const handlePickerChange = ([r, g, b]: [number, number, number, number]) => {
    const hex = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    commitColor(hex)
  }

  const handleInputBlur = () => {
    const nextColor = normalizeHexColor(draftValue)

    if (!nextColor) {
      setDraftValue(normalizedValue)
      return
    }

    setDraftValue(nextColor)
    if (nextColor !== normalizedValue) {
      onChange(nextColor)
    }
  }

  return (
    <RowFlex className={cn('min-w-0 max-w-full flex-wrap items-center gap-3', className)}>
      <RowFlex className="min-w-0 max-w-full flex-wrap gap-3">
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
                'relative flex h-6 w-6 items-center justify-center rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-ring/50'
              )}
              onClick={() => commitColor(normalizedPreset)}>
              <span
                className={cn('h-5 w-5 rounded-full border-2', selected ? 'border-border' : 'border-transparent')}
                style={{ backgroundColor: normalizedPreset }}
              />
            </button>
          )
        })}
      </RowFlex>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={ariaLabel}
            className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span className="h-5 w-5 rounded-sm border border-border" style={{ backgroundColor: normalizedValue }} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <ColorPicker value={normalizedValue} onChange={handlePickerChange} className="gap-3">
            <ColorPickerSelection className="h-40 w-full rounded-lg" />
            <RowFlex className="items-center gap-2">
              <ColorPickerEyeDropper size="icon-sm" />
              <ColorPickerHue className="flex-1" />
            </RowFlex>
          </ColorPicker>
        </PopoverContent>
      </Popover>
      <Input
        value={draftValue}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={handleInputBlur}
        className="h-8 w-24 font-mono text-xs uppercase"
        spellCheck={false}
      />
    </RowFlex>
  )
}

export default ThemeColorPicker
