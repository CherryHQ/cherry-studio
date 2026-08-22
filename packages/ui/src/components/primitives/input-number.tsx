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
 *
 * `min`/`max` mean *clamp into this range on commit*, which is only meaningful
 * where the number is a magnitude — where larger and smaller say something, so a
 * bound is a sensible answer to a value beyond it. Where the number is an
 * identifier (a port, an id) its size means nothing and clamping would invent a
 * value nobody chose: pass no range and validate in the caller instead.
 *
 * A minus sign is therefore always typable. Whether the value may be negative is
 * a range question, settled on commit like any other, not a keystroke question.
 *
 * `min > max` is a call-site bug: no number satisfies it, so the field settles on
 * none. Committing yields `null` and the arrows refuse to step, which empties the
 * field on every commit — visible enough to find in development, where a silent
 * pick between the two bounds would not be. It warns on every render too.
 *
 * The field is a spin button: ArrowUp/ArrowDown step by `step`, straight into
 * `[min, max]` — an arrow press is a whole gesture, not a half-typed number, so
 * the caret cannot be trapped and the next *allowed* value is what was asked
 * for. Stepping reports like typing does and still settles on blur/Enter. The
 * range rides along in `aria-value*`, without which a screen-reader user has no
 * way to know a bound exists until the silent clamp on blur moves their number.
 * The wheel is deliberately left alone: over a `type="text"` field it scrolls
 * the page, which is what someone scrolling past a form means.
 *
 * Escape discards the edit and stops there. It restores what the edit started
 * from — reported through `onValueChange`, since a live-coupled caller has
 * already been told the typed value — and does not bubble, because the app exits
 * fullscreen on any Escape reaching `window` and this one is already spent.
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
  /**
   * Fires on blur/Enter with the normalized value; route it back into `value` to render it.
   *
   * Nearly every caller wants this one: it is the only callback that normalizes,
   * so without it `min`/`max`/`step` never reach a committed value. Skipping it
   * therefore means not caring what those bounds do — and the check for that is
   * that none of the three is declared. Declaring `min`/`max` and skipping this
   * is worse than decorative: they still publish an `aria` range that nothing
   * enforces.
   */
  onBlur?: (value: number | null) => void
  /** The floor a committed or stepped value is clamped up to, negatives included. Also published as `aria-valuemin`. */
  min?: number
  /** The ceiling a committed or stepped value is clamped down to. Also published as `aria-valuemax`. */
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
const allowsDecimal = (step?: number) => step === undefined || !Number.isInteger(step)

const typablePattern = /^-?\d*\.?\d*(?:e[+-]?\d*)?$/i

/**
 * Accepts anything that could still become a number — `"1."`, `"-"`, `"1e-"` —
 * and rejects the rest wholesale. Deleting the offending characters instead
 * would silently rewrite the magnitude: `"1e-6"` would become `"16"`.
 */
function isTypable(raw: string): boolean {
  return typablePattern.test(raw)
}

/** `min > max` admits no value at all, so the field can settle on none — see `InputNumberProps`. */
const isEmptyRange = (min?: number, max?: number) => min !== undefined && max !== undefined && min > max

/** Normalizes on commit only: an integer `step` truncates, then the value is clamped into range. */
function parse(raw: string, min?: number, max?: number, step?: number): number | null {
  const parsed = Number(raw)
  if (raw === '' || !Number.isFinite(parsed) || isEmptyRange(min, max)) {
    return null
  }
  const normalized = allowsDecimal(step) ? parsed : Math.trunc(parsed)
  if (min !== undefined && normalized < min) return min
  if (max !== undefined && normalized > max) return max
  return normalized
}

/** Reads what the field shows right now — the draft while editing, `value` otherwise. */
function toNumber(raw: string): number | null {
  const parsed = Number(raw)
  return raw === '' || !Number.isFinite(parsed) ? null : parsed
}

/**
 * Steps in the step's own precision: adding `0.1` in binary floating point
 * otherwise surfaces as `0.30000000000000004`.
 */
function stepFrom(base: number, step: number, min?: number, max?: number): number {
  const decimals = String(step).split('.')[1]?.length ?? 0
  const stepped = Number((base + step).toFixed(decimals))
  if (min !== undefined && stepped < min) return min
  if (max !== undefined && stepped > max) return max
  return stepped
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
    console.warn(
      `InputNumber: min (${min}) is greater than max (${max}); no value can satisfy that, so the field will settle on none.`
    )
  }

  // Non-null only while the field is focused: an unfocused field renders `value`
  // directly, so there is no second copy of it to keep in sync.
  const [draft, setDraft] = React.useState<string | null>(null)
  const text = draft ?? format(value)
  // What the current edit started from. `value` has already moved for callers that
  // write on every `onValueChange`, so Escape cannot restore from the prop.
  const preEdit = React.useRef<number | null>(null)

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.value
    // ReactDOM restores the rendered text on a controlled input whose state did
    // not change, so returning here is what drops the rejected input.
    if (!isTypable(next)) return
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
    // Swallowed so it stops at the React root: the app exits fullscreen on any
    // Escape that reaches `window`, and this one is spent discarding the edit.
    if (event.key === 'Escape') {
      event.stopPropagation()
      setDraft(format(preEdit.current))
      onValueChange?.(preEdit.current)
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Without this the caret jumps to the end of the text instead.
      event.preventDefault()
      if (isEmptyRange(min, max)) return
      const delta = (step ?? 1) * (event.key === 'ArrowUp' ? 1 : -1)
      const next = stepFrom(toNumber(text) ?? value ?? min ?? 0, delta, min, max)
      setDraft(format(next))
      onValueChange?.(next)
    }
    onKeyDown?.(event)
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode={allowsDecimal(step) ? 'decimal' : 'numeric'}
      role="spinbutton"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={toNumber(text) ?? undefined}
      value={text}
      className={cn(sizeClasses[size], className)}
      onFocus={(event) => {
        preEdit.current = value
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
