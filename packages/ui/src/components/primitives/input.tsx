import { cn } from '@cherrystudio/ui/lib/utils'
import { Clock } from 'lucide-react'
import * as React from 'react'

import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from './popover'

interface InputProps extends React.ComponentProps<'input'> {
  'data-slot'?: string
}

function Input({ className, type, 'data-slot': dataSlot = 'input', ...props }: InputProps) {
  if (type === 'time') {
    return <TimeInput className={className} data-slot={dataSlot} {...props} />
  }

  return (
    <input
      {...props}
      type={type}
      data-slot={dataSlot}
      className={cn(
        inputClassName,
        '[&::-webkit-calendar-picker-indicator]:opacity-70 hover:[&::-webkit-calendar-picker-indicator]:opacity-100',
        dateTimeEditClassName,
        className
      )}
    />
  )
}

function TimeInput({
  className,
  value,
  defaultValue,
  onChange,
  disabled,
  readOnly,
  'data-slot': dataSlot = 'input',
  ...props
}: Omit<InputProps, 'type'>) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const isControlled = value !== undefined
  const [open, setOpen] = React.useState(false)
  const [internalValue, setInternalValue] = React.useState(() => coerceTimeInputValue(defaultValue))
  const timeValue = isControlled ? coerceTimeInputValue(value) : internalValue

  React.useEffect(() => {
    if (isControlled) return
    setInternalValue(coerceTimeInputValue(defaultValue))
  }, [defaultValue, isControlled])

  const handleInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!isControlled) setInternalValue(event.currentTarget.value)
      onChange?.(event)
    },
    [isControlled, onChange]
  )

  const commitTimeValue = React.useCallback(
    (nextValue: string) => {
      const input = inputRef.current

      if (!isControlled) setInternalValue(nextValue)

      if (!input) return

      setInputElementValue(input, nextValue)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    },
    [isControlled]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          data-slot="time-input-wrapper"
          className={cn('relative block', dataSlot === 'input-group-control' && 'flex-1')}>
          <input
            {...props}
            ref={inputRef}
            type="time"
            data-slot={dataSlot ?? 'input'}
            value={timeValue}
            disabled={disabled}
            readOnly={readOnly}
            onChange={handleInputChange}
            className={cn(
              inputClassName,
              'pr-9 [&::-webkit-calendar-picker-indicator]:hidden',
              open && !disabled && !readOnly && 'ring-ring/50 ring-[3px]',
              dateTimeEditClassName,
              className
            )}
          />
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Open time picker"
              disabled={disabled || readOnly}
              className="text-foreground-muted hover:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-sm outline-none transition-colors focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50">
              <Clock className="size-4" />
            </button>
          </PopoverTrigger>
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        aria-label="Time picker"
        className="w-75 max-w-[calc(100vw-1rem)] rounded-md p-2"
        onOpenAutoFocus={(event) => event.preventDefault()}>
        <TimePickerPanel value={timeValue} onValueChange={commitTimeValue} />
      </PopoverContent>
    </Popover>
  )
}

function TimePickerPanel({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  const parsed = parseTimeValue(value)
  const selectedPeriod = parsed.hours >= 12 ? 'PM' : 'AM'
  const selectedHour = toDisplayHour(parsed.hours)

  return (
    <div className="grid grid-cols-3 gap-2">
      <TimePickerColumn
        label="Hour"
        values={hourOptions}
        selectedValue={selectedHour}
        onSelect={(nextHour) => {
          onValueChange(formatTimeValue(fromDisplayHour(nextHour, selectedPeriod), parsed.minutes, parsed.seconds))
        }}
      />
      <TimePickerColumn
        label="Minute"
        values={minuteOptions}
        selectedValue={parsed.minutes}
        onSelect={(nextMinute) => {
          onValueChange(formatTimeValue(parsed.hours, nextMinute, parsed.seconds))
        }}
      />
      <TimePickerColumn
        label="Period"
        values={periodOptions}
        selectedValue={selectedPeriod}
        formatLabel={(period) => period}
        onSelect={(nextPeriod) => {
          onValueChange(formatTimeValue(fromDisplayHour(selectedHour, nextPeriod), parsed.minutes, parsed.seconds))
        }}
      />
    </div>
  )
}

function TimePickerColumn<T extends number | 'AM' | 'PM'>({
  label,
  values,
  selectedValue,
  formatLabel = formatTwoDigit,
  onSelect
}: {
  label: string
  values: readonly T[]
  selectedValue: T
  formatLabel?: (value: T) => string
  onSelect: (value: T) => void
}) {
  return (
    <div className="max-h-72 space-y-1 overflow-y-auto pr-2">
      {values.map((value) => {
        const selected = value === selectedValue
        const valueLabel = formatLabel(value)
        const ariaLabel = label === 'Period' ? valueLabel : `${label} ${valueLabel}`

        return (
          <button
            key={value}
            type="button"
            aria-label={ariaLabel}
            aria-pressed={selected}
            onClick={() => onSelect(value)}
            className={cn(
              'flex h-9 w-full items-center justify-center rounded-md px-3 font-mono text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
              selected ? 'bg-primary text-white hover:bg-primary hover:text-white' : 'text-foreground hover:bg-accent'
            )}>
            {valueLabel}
          </button>
        )
      })}
    </div>
  )
}

const inputClassName =
  'border-input bg-background file:text-foreground placeholder:text-foreground-muted selection:bg-primary selection:text-primary-foreground h-9 w-full min-w-0 rounded-md border px-3 py-1 text-base transition-[color,box-shadow] outline-none [accent-color:var(--color-primary)] [color-scheme:light_dark] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed md:text-sm focus-visible:border-input focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive'

const dateTimeEditClassName =
  '[&::-webkit-datetime-edit-day-field]:rounded-sm [&::-webkit-datetime-edit-day-field:focus]:bg-primary [&::-webkit-datetime-edit-day-field:focus]:text-white [&::-webkit-datetime-edit-hour-field]:rounded-sm [&::-webkit-datetime-edit-hour-field:focus]:bg-primary [&::-webkit-datetime-edit-hour-field:focus]:text-white [&::-webkit-datetime-edit-minute-field]:rounded-sm [&::-webkit-datetime-edit-minute-field:focus]:bg-primary [&::-webkit-datetime-edit-minute-field:focus]:text-white [&::-webkit-datetime-edit-month-field]:rounded-sm [&::-webkit-datetime-edit-month-field:focus]:bg-primary [&::-webkit-datetime-edit-month-field:focus]:text-white [&::-webkit-datetime-edit-second-field]:rounded-sm [&::-webkit-datetime-edit-second-field:focus]:bg-primary [&::-webkit-datetime-edit-second-field:focus]:text-white [&::-webkit-datetime-edit-year-field]:rounded-sm [&::-webkit-datetime-edit-year-field:focus]:bg-primary [&::-webkit-datetime-edit-year-field:focus]:text-white [&::-webkit-datetime-edit-ampm-field]:rounded-sm [&::-webkit-datetime-edit-ampm-field:focus]:bg-primary [&::-webkit-datetime-edit-ampm-field:focus]:text-white'

const hourOptions = Array.from({ length: 12 }, (_, index) => index + 1)
const minuteOptions = Array.from({ length: 60 }, (_, index) => index)
const periodOptions = ['AM', 'PM'] as const

function coerceTimeInputValue(value: InputProps['value']) {
  return typeof value === 'string' ? value : ''
}

function parseTimeValue(value: string) {
  const [rawHours, rawMinutes, rawSeconds] = value.split(':')
  const hours = clampTimePart(Number.parseInt(rawHours, 10), 23)
  const minutes = clampTimePart(Number.parseInt(rawMinutes, 10), 59)
  const seconds = rawSeconds === undefined ? undefined : clampTimePart(Number.parseInt(rawSeconds, 10), 59)

  return { hours, minutes, seconds }
}

function clampTimePart(value: number, max: number) {
  if (Number.isNaN(value)) return 0
  return Math.min(Math.max(value, 0), max)
}

function toDisplayHour(hours: number) {
  const displayHour = hours % 12
  return displayHour === 0 ? 12 : displayHour
}

function fromDisplayHour(hour: number, period: 'AM' | 'PM') {
  if (period === 'AM') return hour === 12 ? 0 : hour
  return hour === 12 ? 12 : hour + 12
}

function formatTimeValue(hours: number, minutes: number, seconds?: number) {
  const baseValue = `${formatTwoDigit(hours)}:${formatTwoDigit(minutes)}`
  return seconds === undefined ? baseValue : `${baseValue}:${formatTwoDigit(seconds)}`
}

function formatTwoDigit(value: number | 'AM' | 'PM') {
  return typeof value === 'number' ? String(value).padStart(2, '0') : value
}

function setInputElementValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set

  if (valueSetter) {
    valueSetter.call(input, value)
    return
  }

  input.value = value
}

export { Input, type InputProps }
