import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

import { Input } from './input'

interface InputNumberProps
  extends Omit<React.ComponentProps<typeof Input>, 'type' | 'inputMode' | 'value' | 'onChange' | 'size'> {
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  /** Report only on blur/Enter instead of on every keystroke. */
  changeOnBlur?: boolean
  size?: 'small' | 'middle' | 'large'
}

const sizeClasses: Record<NonNullable<InputNumberProps['size']>, string> = {
  small: 'h-8 text-sm',
  middle: 'h-9 text-sm',
  large: 'h-10 text-base'
}

const allowsNegative = (min?: number) => min === undefined || min < 0
const allowsDecimal = (step?: number) => step === undefined || !Number.isInteger(step)

/** Filters to digits, one decimal point, and a minus sign where `min` permits it. Keeps partial input like "1." */
function sanitize(raw: string, min?: number): string {
  const negative = allowsNegative(min) && raw.trimStart().startsWith('-')
  const [integerPart, ...fractionParts] = raw.replace(/[^\d.]/g, '').split('.')
  const body = fractionParts.length > 0 ? `${integerPart}.${fractionParts.join('')}` : integerPart
  return negative ? `-${body}` : body
}

/** Normalizes on commit only: an integer `step` truncates, then the value is clamped into range. */
function parse(raw: string, min?: number, max?: number, step?: number): number | null {
  const parsed = Number(raw)
  if (raw === '' || !Number.isFinite(parsed)) {
    return null
  }
  const normalized = allowsDecimal(step) ? parsed : Math.trunc(parsed)
  if (min !== undefined && normalized < min) return min
  if (max !== undefined && normalized > max) return max
  return normalized
}

function InputNumber({
  value,
  onChange,
  min,
  max,
  step,
  changeOnBlur = false,
  size = 'middle',
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: InputNumberProps) {
  const [draft, setDraft] = React.useState(() => (value === null ? '' : String(value)))
  const [editing, setEditing] = React.useState(false)

  React.useEffect(() => {
    if (!editing) {
      setDraft(value === null ? '' : String(value))
    }
  }, [editing, value])

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = sanitize(event.target.value, min)
    setDraft(next)
    if (!changeOnBlur) {
      // Report the raw parse: clamping mid-edit would trap the user below `min`.
      onChange(next === '' || !Number.isFinite(Number(next)) ? null : Number(next))
    }
  }

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const committed = parse(draft, min, max, step)
    setEditing(false)
    setDraft(committed === null ? '' : String(committed))
    onChange(committed)
    onBlur?.(event)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
    onKeyDown?.(event)
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode={allowsDecimal(step) ? 'decimal' : 'numeric'}
      value={draft}
      className={cn(sizeClasses[size], className)}
      onFocus={(event) => {
        setEditing(true)
        onFocus?.(event)
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}

export { InputNumber, type InputNumberProps }
