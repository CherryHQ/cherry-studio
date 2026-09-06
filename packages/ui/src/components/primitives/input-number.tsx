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
 * An incomplete numeric prefix that is still not a number on commit restores
 * the value from the start of the edit; only an actually empty field settles
 * to `null`.
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
   * Return the commit's promise when it is async and the field will hold the settled
   * value until it settles, marking itself `aria-busy`/`data-busy` meanwhile. Without
   * that, a caller whose `value` only catches up after a round trip renders the *old*
   * value in between — the field drops its own copy on blur, before the caller has a
   * new one. Returning nothing keeps the synchronous behaviour.
   *
   * Any caller that persists the value wants this one — it is the only callback
   * that hands over a settled value. It both normalizes (so without it
   * `min`/`max`/`step` never reach a committed value — declaring `min`/`max` and
   * skipping this is worse than decorative: they still publish an `aria` range
   * that nothing enforces) and restores an abandoned incomplete edit (`-`, `1e`)
   * to what it started from. That second job has nothing to do with the bounds,
   * so declaring none of the three is not a licence to skip this: a caller that
   * persists through `onValueChange` alone keeps whatever the emptying before
   * the incomplete text wrote. Only a consumer that is purely live-coupled —
   * a slider tracking the field, with no state of its own to settle — can do
   * without it.
   */
  onBlur?: (value: number | null) => void | Promise<unknown>
  /** The floor a committed or stepped value is clamped up to, negatives included. Also published as `aria-valuemin`. */
  min?: number
  /** The ceiling a committed or stepped value is clamped down to. Also published as `aria-valuemax`. */
  max?: number
  /**
   * The spacing of the grid the arrows move along, anchored at `min` when one is
   * declared — `min={0.5} step={1}` steps 0.5, 1.5, 2.5, as a native number input does.
   *
   * It doubles as the field's precision: an integer `step` means the value is an
   * integer, which sets `inputMode` and truncates on commit. Commit does **not** snap
   * to the grid — a typed `7` survives under `step={5}`. Rejecting off-grid values is
   * a validation decision, and this field only clamps; anything richer belongs to the
   * caller.
   */
  step?: number
  size?: 'small' | 'middle' | 'large'
}

const sizeClasses: Record<NonNullable<InputNumberProps['size']>, string> = {
  small: 'h-8 text-sm',
  middle: 'h-9 text-sm',
  large: 'h-10 text-base'
}

/** Digits after the point, reading `1e-7` as seven rather than as none. */
const decimalsOf = (value: number) => {
  const [mantissa, exponent] = String(value).split('e')
  const fraction = mantissa.split('.')[1]?.length ?? 0
  return exponent ? Math.max(0, fraction - Number(exponent)) : fraction
}

// `String` switches to exponential below 1e-6, which would hand back `1e-7` to
// someone who typed `0.0000001`. Magnitudes at the other end stay exponential —
// `toFixed` returns those unchanged, and no field is asking for them.
const format = (value: number | null) => {
  if (value === null) return ''
  const text = String(value)
  return text.includes('e') ? value.toFixed(Math.min(100, decimalsOf(value))) : text
}
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

const isPromise = (value: unknown): value is Promise<unknown> =>
  typeof (value as Promise<unknown> | undefined)?.then === 'function'

const inRange = (value: number, min?: number, max?: number) =>
  (min === undefined || value >= min) && (max === undefined || value <= max)

/**
 * Moves to the next value on the grid `step` describes, in the direction of travel —
 * the same rule `stepUp`/`stepDown` follow on a native number input. The grid is
 * anchored at `min` when one is declared, so `min={0.5} step={1}` steps 0.5, 1.5, 2.5.
 *
 * Adding `step` to an off-grid base instead would carry the remainder along: from
 * `3.7` with `step={1}` the next value is 4, not 4.7 — nor 5, which is what rounding
 * the sum to the step's precision used to produce. Rounding still finishes the job,
 * since `0.1` in binary floating point otherwise surfaces as `0.30000000000000004`.
 *
 * A base already outside the range is left where it is rather than clamped, so an
 * arrow never moves the value against its own direction.
 */
function stepFrom(base: number, step: number, min?: number, max?: number): number {
  const anchor = min ?? 0
  const size = Math.abs(step)
  const offsets = (base - anchor) / size
  // Tolerance so a base already on the grid moves one whole step rather than
  // being nudged by the remainder of its own division.
  const epsilon = 1e-9
  const next = step > 0 ? Math.floor(offsets + epsilon) + 1 : Math.ceil(offsets - epsilon) - 1
  const decimals = Math.max(decimalsOf(size), decimalsOf(anchor))
  const stepped = Number((anchor + next * size).toFixed(decimals))
  const clamped = min !== undefined && stepped < min ? min : max !== undefined && stepped > max ? max : stepped
  // An arrow must never move the value against its own direction. A base already
  // outside the range would otherwise be dragged backwards by the clamp: pressing
  // Down on a value below `min` would raise it.
  return (step > 0 ? clamped < base : clamped > base) ? base : clamped
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
  const [busy, setBusy] = React.useState(false)
  // Bumped by every focus and blur, so a commit that settles after the user has come
  // back cannot clear the text they are typing now.
  const generation = React.useRef(0)
  // Set by Escape so the blur it triggers settles on what the edit started from:
  // `draft` has not re-rendered yet, so the text still reads what was typed.
  const discarding = React.useRef(false)

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
    const isIncomplete = text !== '' && !Number.isFinite(Number(text))
    const settled = discarding.current || isIncomplete ? preEdit.current : parse(text, min, max, step)
    discarding.current = false
    const commit = onBlur?.(settled)
    if (!isPromise(commit)) {
      setDraft(null)
      return
    }
    // Hold the settled value until the caller's `value` can catch up.
    const current = ++generation.current
    setDraft(format(settled))
    setBusy(true)
    const release = () => {
      if (generation.current !== current) return
      setBusy(false)
      setDraft(null)
    }
    commit.then(release, release)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
    // Discards the edit and leaves the field, the way Escape dismisses elsewhere.
    // Swallowed so it stops at the React root: the app exits fullscreen on any
    // Escape that reaches `window`, and this one is spent leaving the edit.
    if (event.key === 'Escape') {
      event.stopPropagation()
      discarding.current = true
      onValueChange?.(preEdit.current)
      event.currentTarget.blur()
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      // Without this the caret jumps to the end of the text instead.
      event.preventDefault()
      if (isEmptyRange(min, max)) return
      const delta = (step ?? 1) * (event.key === 'ArrowUp' ? 1 : -1)
      // An empty field has no base to step from, so the first press lands on the
      // bound it is heading for — otherwise `min` itself is unreachable by arrow.
      const current = toNumber(text)
      const bound = event.key === 'ArrowUp' ? min : max
      const next = current === null ? (bound ?? stepFrom(0, delta, min, max)) : stepFrom(current, delta, min, max)
      // With no bound that way, stepping from an assumed zero can leave the range
      // entirely. There is no value to offer, so the field stays empty.
      if (current === null && bound === undefined && !inRange(next, min, max)) {
        return
      }
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
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={toNumber(text) ?? undefined}
      value={text}
      className={cn(sizeClasses[size], 'data-[busy=true]:cursor-progress data-[busy=true]:opacity-40', className)}
      onFocus={(event) => {
        generation.current += 1
        setBusy(false)
        // Seeded from what is on screen, not from `value`: a commit still in flight
        // is showing its settled value while `value` is one round trip behind.
        preEdit.current = toNumber(text)
        setDraft(text)
        onFocus?.(event)
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  )
}

export { InputNumber, type InputNumberProps }
