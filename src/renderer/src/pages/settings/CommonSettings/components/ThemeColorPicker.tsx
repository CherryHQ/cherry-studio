import { Input, RowFlex } from '@cherrystudio/ui'
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

  return (
    <RowFlex className={cn('items-center gap-3', className)}>
      <RowFlex className="gap-3">
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
      <label className="relative flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-background shadow-xs outline-none focus-within:ring-3 focus-within:ring-ring/50">
        <input
          type="color"
          value={normalizedValue}
          aria-label={ariaLabel}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => commitColor(event.target.value)}
        />
        <span className="h-5 w-5 rounded-sm border border-border" style={{ backgroundColor: normalizedValue }} />
      </label>
      <Input
        value={draftValue}
        onChange={(event) => commitColor(event.target.value)}
        onBlur={() => setDraftValue(normalizedValue)}
        className="h-8 w-24 font-mono text-xs uppercase"
        spellCheck={false}
      />
    </RowFlex>
  )
}

export default ThemeColorPicker
