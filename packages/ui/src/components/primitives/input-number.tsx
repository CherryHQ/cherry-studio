import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

import { Input } from './input'

/**
 * A number field that owns the text being typed, so partial input like `"1."`,
 * `"-"` or `"3.9"` survives while the caret is in it.
 *
 * Because it owns that text it must settle it when the caret leaves: on
 * blur/Enter the field normalizes what was typed — clamped into `[min, max]`,
 * truncated when `step` is an integer — and hands the result to `onBlur`.
 * **Settling is not configurable**; a field cannot be left showing `"1."`.
 *
 * What `onBlur` hands over is a fact — "this is the value the field settled
 * on" — and the meaning is the caller's: persist it, ignore it, diff it against
 * something else. But the field renders `value`, never its own result, so the
 * normalized value reaches the screen only once the caller routes it back.
 * `onValueChange` never normalizes, which makes `onBlur` the callback nearly
 * every caller needs.
 *
 * Both callbacks take the value, not the DOM event: the raw `FocusEvent` would
 * be misleading here anyway, since `event.target.value` at that point is still
 * the text the user typed.
 */
interface InputNumberProps
  extends Omit<React.ComponentProps<typeof Input>, 'type' | 'inputMode' | 'value' | 'onChange' | 'onBlur' | 'size'> {
  value: number | null
  /**
   * Fires when the text becomes a value, un-normalized — clamping mid-edit would
   * trap the caret below `min` (typing `50` into a `min={10}` field would stop
   * at the first `5`). Use it for live coupling: form state, a slider, etc.
   *
   * Deliberately not `onChange`: it stays silent while the text is on its way to
   * being a value — `"-"`, `"1e"`, `"1e-"` — so it is not one event per
   * keystroke. Those are not empty either, and calling them `null` would make a
   * caller that substitutes a default write that default mid-keystroke. Only an
   * emptied field is `null`.
   */
  onValueChange?: (value: number | null) => void
  /** Fires on blur/Enter with the normalized value; route it back into `value` to render it. */
  onBlur?: (value: number | null) => void
  /** Also decides whether a minus sign can be typed: omitted or negative allows it. */
  min?: number
  /** Read on commit only, so it does nothing without `onBlur`. An empty range settles on `min` and warns. */
  max?: number
  /** Also decides whether the value is an integer: an integer `step` truncates on commit. */
  step?: number
  size?: 'small' | 'middle' | 'large'
}

const sizeClasses: Record<NonNullable<InputNumberProps['size']>, string> = {
  small: 'h-8 text-sm',
  middle: 'h-9 text-sm',
  large: 'h-10 text-base'
}

const format = (value: number | null) => (value === null ? '' : String(value))
const allowsNegative = (min?: number) => min === undefined || min < 0
const allowsDecimal = (step?: number) => step === undefined || !Number.isInteger(step)

const signedPattern = /^-?\d*\.?\d*(?:e[+-]?\d*)?$/i
const unsignedPattern = /^\d*\.?\d*(?:e[+-]?\d*)?$/i

/**
 * Accepts anything that could still become a number — `"1."`, `"-"`, `"1e-"` —
 * and rejects the rest wholesale. Deleting the offending characters instead
 * would silently rewrite the magnitude: `"1e-6"` would become `"16"`.
 */
function isTypable(raw: string, min?: number): boolean {
  return (allowsNegative(min) ? signedPattern : unsignedPattern).test(raw)
}

/** Normalizes on commit only: an integer `step` truncates, then the value is clamped into range. `min` wins an empty range. */
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
  onValueChange,
  min,
  max,
  step,
  size = 'middle',
  className,
  onFocus,
  onBlur,
  onKeyDown,
  ...props
}: InputNumberProps) {
  if (min !== undefined && max !== undefined && min > max) {
    console.warn(`InputNumber: min (${min}) is greater than max (${max}); the field will settle on min.`)
  }

  // Non-null only while the field is focused: an unfocused field renders `value`
  // directly, so there is no second copy of it to keep in sync.
  const [draft, setDraft] = React.useState<string | null>(null)
  const text = draft ?? format(value)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    // ReactDOM restores the rendered text on a controlled input whose state did
    // not change, so returning here is what drops the rejected input.
    if (!isTypable(next, min)) return
    setDraft(next)
    const parsed = Number(next)
    // A viable prefix like `"-"` or `"1e"` is not yet a value, and reporting it
    // as `null` would make callers that map null to a default write that default
    // mid-gesture. Only an emptied field is `null`.
    if (next === '') {
      onValueChange?.(null)
    } else if (Number.isFinite(parsed)) {
      onValueChange?.(parsed)
    }
  }

  const handleBlur = () => {
    setDraft(null)
    onBlur?.(parse(text, min, max, step))
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
    // Discards the edit. Focus stays, so the restored value is what later commits.
    if (event.key === 'Escape') {
      setDraft(format(value))
    }
    onKeyDown?.(event)
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode={allowsDecimal(step) ? 'decimal' : 'numeric'}
      value={text}
      className={cn(sizeClasses[size], className)}
      onFocus={(event) => {
        setDraft(format(value))
        onFocus?.(event)
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}

export { InputNumber, type InputNumberProps }
