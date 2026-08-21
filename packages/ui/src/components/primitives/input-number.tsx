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

/** Filters to the character set the declared constraints permit; keeps partial input like "1." or "-". */
function sanitize(raw: string, min?: number, step?: number): string {
  const negative = allowsNegative(min) && raw.trimStart().startsWith('-')
  const kept = raw.replace(allowsDecimal(step) ? /[^\d.]/g : /[^\d]/g, '')
  const [integerPart, ...fractionParts] = kept.split('.')
  const body = fractionParts.length > 0 ? `${integerPart}.${fractionParts.join('')}` : integerPart
  return negative ? `-${body}` : body
}

function parse(raw: string, min?: number, max?: number): number | null {
  const parsed = Number(raw)
  if (raw === '' || !Number.isFinite(parsed)) {
    return null
  }
  if (min !== undefined && parsed < min) return min
  if (max !== undefined && parsed > max) return max
  return parsed
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
    const next = sanitize(event.target.value, min, step)
    setDraft(next)
    if (!changeOnBlur) {
      // Report the raw parse: clamping mid-edit would trap the user below `min`.
      onChange(next === '' || !Number.isFinite(Number(next)) ? null : Number(next))
    }
  }

  const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    const committed = parse(draft, min, max)
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
