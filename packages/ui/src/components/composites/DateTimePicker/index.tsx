import { format as formatDate } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../lib/utils'
import { Button } from '../../primitives/button'
import { Calendar, type CalendarProps } from '../../primitives/calendar'
import { Input } from '../../primitives/input'
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'

export type DateTimeGranularity = 'day' | 'hour' | 'minute' | 'second'

export type DateTimePickerLabels = {
  hour?: string
  minute?: string
  second?: string
}

export type DateTimePickerProps = {
  value?: Date | null
  defaultValue?: Date | null
  onChange?: (date: Date | undefined) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  granularity?: DateTimeGranularity
  format?: string
  placeholder?: React.ReactNode
  disabled?: boolean
  className?: string
  triggerClassName?: string
  popoverClassName?: string
  calendarProps?: Omit<CalendarProps, 'mode' | 'selected' | 'onSelect' | 'month' | 'onMonthChange'>
  labels?: DateTimePickerLabels
}

const defaultLabels = {
  hour: 'Hour',
  minute: 'Minute',
  second: 'Second'
} satisfies Required<DateTimePickerLabels>

const defaultFormatByGranularity: Record<DateTimeGranularity, string> = {
  day: 'yyyy-MM-dd',
  hour: 'yyyy-MM-dd HH',
  minute: 'yyyy-MM-dd HH:mm',
  second: 'yyyy-MM-dd HH:mm:ss'
}

function DateTimePicker({
  value,
  defaultValue,
  onChange,
  open,
  defaultOpen,
  onOpenChange,
  granularity = 'day',
  format,
  placeholder = 'Pick a date',
  disabled,
  className,
  triggerClassName,
  popoverClassName,
  calendarProps,
  labels
}: DateTimePickerProps) {
  const isValueControlled = value !== undefined
  const [internalValue, setInternalValue] = React.useState<Date | undefined>(() => normalizeDate(defaultValue))
  const selectedDate = isValueControlled ? normalizeDate(value) : internalValue
  const [month, setMonth] = React.useState<Date>(() => {
    const initialDate = normalizeDate(value) ?? normalizeDate(defaultValue) ?? new Date()
    return getMonthDate(initialDate)
  })

  const isOpenControlled = open !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen ?? false)
  const pickerOpen = isOpenControlled ? open : internalOpen
  const mergedLabels = { ...defaultLabels, ...labels }
  const selectedYear = selectedDate?.getFullYear()
  const selectedMonth = selectedDate?.getMonth()

  React.useEffect(() => {
    if (selectedYear === undefined || selectedMonth === undefined) return
    setMonth(new Date(selectedYear, selectedMonth))
  }, [selectedMonth, selectedYear])

  const setPickerOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!isOpenControlled) setInternalOpen(nextOpen)
      onOpenChange?.(nextOpen)
    },
    [isOpenControlled, onOpenChange]
  )

  const commitDate = React.useCallback(
    (nextDate: Date | undefined) => {
      if (!isValueControlled) setInternalValue(nextDate)
      onChange?.(nextDate)
    },
    [isValueControlled, onChange]
  )

  const handleSelectDate = React.useCallback(
    (date: Date | undefined) => {
      if (!date) {
        commitDate(undefined)
        return
      }

      const nextDate = mergeDatePart(date, selectedDate)
      setMonth(getMonthDate(nextDate))
      commitDate(nextDate)
      if (granularity === 'day') setPickerOpen(false)
    },
    [commitDate, granularity, selectedDate, setPickerOpen]
  )

  const handleTimePartChange = React.useCallback(
    (part: 'hours' | 'minutes' | 'seconds', rawValue: string) => {
      const nextDate = selectedDate ? new Date(selectedDate) : new Date()
      const max = part === 'hours' ? 23 : 59
      const nextValue = clampTimeValue(rawValue, max)

      if (part === 'hours') nextDate.setHours(nextValue)
      if (part === 'minutes') nextDate.setMinutes(nextValue)
      if (part === 'seconds') nextDate.setSeconds(nextValue)

      commitDate(nextDate)
    },
    [commitDate, selectedDate]
  )

  const formattedValue = selectedDate
    ? safeFormatDate(selectedDate, format ?? defaultFormatByGranularity[granularity])
    : null

  return (
    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          data-empty={!formattedValue}
          className={cn(
            'h-9 w-[240px] justify-start text-left font-normal data-[empty=true]:text-muted-foreground',
            triggerClassName
          )}>
          <CalendarIcon className="size-4" />
          <span className="truncate">{formattedValue ?? placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn('w-auto p-0', popoverClassName)}>
        <div className={cn('flex flex-col', className)}>
          <Calendar
            {...calendarProps}
            mode="single"
            selected={selectedDate}
            onSelect={handleSelectDate}
            month={month}
            onMonthChange={setMonth}
            disabled={disabled || calendarProps?.disabled}
            captionLayout={calendarProps?.captionLayout ?? 'dropdown'}
            hideNavigation={calendarProps?.hideNavigation ?? true}
            startMonth={calendarProps?.startMonth ?? new Date(1900, 0)}
            endMonth={calendarProps?.endMonth ?? new Date(2100, 11)}
          />
          {granularity !== 'day' && (
            <div className="grid grid-cols-3 gap-2 border-border border-t p-3">
              <TimeInput
                label={mergedLabels.hour}
                value={selectedDate?.getHours() ?? 0}
                max={23}
                disabled={disabled}
                onChange={(nextValue) => handleTimePartChange('hours', nextValue)}
              />
              {(granularity === 'minute' || granularity === 'second') && (
                <TimeInput
                  label={mergedLabels.minute}
                  value={selectedDate?.getMinutes() ?? 0}
                  max={59}
                  disabled={disabled}
                  onChange={(nextValue) => handleTimePartChange('minutes', nextValue)}
                />
              )}
              {granularity === 'second' && (
                <TimeInput
                  label={mergedLabels.second}
                  value={selectedDate?.getSeconds() ?? 0}
                  max={59}
                  disabled={disabled}
                  onChange={(nextValue) => handleTimePartChange('seconds', nextValue)}
                />
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimeInput({
  label,
  value,
  max,
  disabled,
  onChange
}: {
  label: string
  value: number
  max: number
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="grid gap-1">
      <span className="sr-only">{label}</span>
      <Input
        aria-label={label}
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={padTimeValue(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 px-2 text-center font-mono text-sm"
      />
    </label>
  )
}

function normalizeDate(date: Date | null | undefined) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : undefined
}

function getMonthDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth())
}

function mergeDatePart(date: Date, current: Date | undefined) {
  const nextDate = new Date(date)

  if (current) {
    nextDate.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds())
  }

  return nextDate
}

function clampTimeValue(value: string, max: number) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) return 0
  return Math.min(Math.max(parsed, 0), max)
}

function padTimeValue(value: number) {
  return String(value).padStart(2, '0')
}

function safeFormatDate(date: Date, format: string) {
  try {
    return formatDate(date, format)
  } catch {
    return date.toLocaleString()
  }
}

export { DateTimePicker }
