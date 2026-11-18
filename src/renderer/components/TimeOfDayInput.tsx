import { useState } from 'react'
import type { ChangeEvent } from 'react'

import { Input } from '@cherrystudio/ui'

export const toTimeOfDay = (minutes: number | null | undefined): string =>
  minutes == null ? '' : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Parses a `type="time"` value into minutes after midnight; null while the field is not a complete time. */
export const fromTimeOfDay = (value: string): number | null => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

interface TimeOfDayInputProps {
  value: number | null
  onChange: (minutes: number | null) => void
  disabled?: boolean
  'aria-label': string
}

/**
 * Time-of-day field backed by the native `type="time"` input.
 *
 * The browser reports `""` until hour and minute are both filled, so the field
 * holds the typed text locally and publishes only a complete time; blur clears
 * the anchor when the field was emptied.
 */
export const TimeOfDayInput = ({ value, onChange, disabled, 'aria-label': ariaLabel }: TimeOfDayInputProps) => {
  const [draft, setDraft] = useState<string | null>(null)
  const display = draft ?? toTimeOfDay(value)

  return (
    <Input
      type="time"
      step={1800}
      className="w-[110px]"
      aria-label={ariaLabel}
      value={display}
      disabled={disabled}
      onChange={(event: ChangeEvent<HTMLInputElement>) => {
        setDraft(event.target.value)
        const minutes = fromTimeOfDay(event.target.value)
        if (minutes !== null) onChange(minutes)
      }}
      onBlur={(event) => {
        // An unfinished segment is not a clear: the browser reports `""` with `badInput` while the
        // hour or minute is still empty, and publishing null would drop the stored anchor.
        const { badInput } = event.currentTarget.validity
        setDraft(null)
        if (!badInput && display === '') onChange(null)
      }}
    />
  )
}
