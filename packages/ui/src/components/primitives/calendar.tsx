import { cn } from '@cherrystudio/ui/lib/utils'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react'
import * as React from 'react'
import {
  type ChevronProps,
  type DayButtonProps,
  DayPicker,
  type DropdownNavProps,
  type DropdownProps,
  getDefaultClassNames,
  type MonthCaptionProps
} from 'react-day-picker'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  components,
  showOutsideDays = true,
  captionLayout = 'dropdown',
  ...props
}: CalendarProps) {
  const defaultClassNames = getDefaultClassNames()
  const dropdownClassName =
    'border-input bg-background h-8 rounded-md border px-2 text-sm outline-none transition-colors focus:border-input focus:ring-3 focus:ring-ring/50 aria-expanded:border-input aria-expanded:ring-3 aria-expanded:ring-ring/50 dark:bg-background'

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      className={cn('p-3', className)}
      classNames={{
        ...defaultClassNames,
        root: cn(defaultClassNames.root, 'w-fit'),
        months: cn(defaultClassNames.months, 'relative flex flex-col gap-4 sm:flex-row'),
        month: cn(defaultClassNames.month, 'space-y-3'),
        month_caption: cn(defaultClassNames.month_caption, 'flex h-8 items-center justify-center'),
        caption_label: cn(defaultClassNames.caption_label, 'font-medium text-sm'),
        dropdowns: cn(defaultClassNames.dropdowns, 'flex w-full items-center justify-center gap-2'),
        dropdown_root: cn(defaultClassNames.dropdown_root, 'relative'),
        dropdown: cn(defaultClassNames.dropdown, dropdownClassName),
        months_dropdown: cn(defaultClassNames.months_dropdown, dropdownClassName),
        years_dropdown: cn(defaultClassNames.years_dropdown, dropdownClassName),
        nav: cn(defaultClassNames.nav, 'absolute inset-x-0 top-3 flex items-center justify-between px-3'),
        button_previous: cn(
          defaultClassNames.button_previous,
          'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
        ),
        button_next: cn(
          defaultClassNames.button_next,
          'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
        ),
        month_grid: cn(defaultClassNames.month_grid, 'w-full border-collapse space-y-1'),
        weekdays: cn(defaultClassNames.weekdays, 'flex'),
        weekday: cn(defaultClassNames.weekday, 'w-8 rounded-md text-center font-normal text-muted-foreground text-xs'),
        week: cn(defaultClassNames.week, 'mt-1 flex w-full'),
        day: cn(defaultClassNames.day, 'size-8 p-0 text-center text-sm'),
        day_button: cn(
          defaultClassNames.day_button,
          'inline-flex size-8 items-center justify-center rounded-md font-normal text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40'
        ),
        selected: cn(defaultClassNames.selected),
        today: cn(defaultClassNames.today),
        outside: cn(defaultClassNames.outside, 'text-muted-foreground opacity-50'),
        disabled: cn(defaultClassNames.disabled, 'text-muted-foreground opacity-40'),
        range_middle: cn(defaultClassNames.range_middle),
        range_start: cn(defaultClassNames.range_start),
        range_end: cn(defaultClassNames.range_end),
        hidden: cn(defaultClassNames.hidden, 'invisible'),
        ...classNames
      }}
      components={{
        MonthCaption: CalendarMonthCaption,
        DropdownNav: CalendarDropdownNav,
        Dropdown: CalendarDropdown,
        Chevron: CalendarChevron,
        DayButton: CalendarDayButton,
        ...components
      }}
      {...props}
    />
  )
}

function CalendarMonthCaption({ children }: MonthCaptionProps) {
  return <>{children}</>
}

function CalendarDropdownNav({ className, ...props }: DropdownNavProps) {
  return <div className={cn('flex w-full items-center gap-2', className)} {...props} />
}

function CalendarDayButton({ className, day, modifiers, ...props }: DayButtonProps) {
  const isSelected = modifiers.selected || modifiers.range_start || modifiers.range_end
  const isRangeEndpoint = modifiers.range_start || modifiers.range_end

  return (
    <button
      type="button"
      data-day={day.isoDate}
      className={cn(
        className,
        modifiers.today &&
          !isSelected &&
          'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
        modifiers.range_middle &&
          'rounded-none bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
        isSelected &&
          'bg-primary text-white hover:bg-primary hover:text-white focus-visible:bg-primary focus-visible:text-white',
        isRangeEndpoint && 'rounded-none',
        modifiers.range_start && 'rounded-l-md',
        modifiers.range_end && 'rounded-r-md'
      )}
      {...props}
    />
  )
}

function CalendarDropdown({
  value,
  onChange,
  options,
  disabled,
  className,
  style,
  'aria-label': ariaLabel
}: DropdownProps) {
  return (
    <Select
      value={value?.toString()}
      disabled={disabled}
      onValueChange={(nextValue) => handleCalendarDropdownChange(nextValue, onChange)}>
      <SelectTrigger
        aria-label={ariaLabel}
        size="sm"
        style={style}
        className={cn('min-w-0 first:flex-1 last:shrink-0', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="center" className="max-h-64">
        {options?.map((option) => (
          <SelectItem key={option.value} value={String(option.value)} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function handleCalendarDropdownChange(value: string | number, onChange: DropdownProps['onChange']) {
  if (!onChange) return

  const event = {
    target: {
      value: String(value)
    }
  } as React.ChangeEvent<HTMLSelectElement>

  onChange(event)
}

function CalendarChevron({ className, orientation, disabled, ...props }: ChevronProps) {
  const iconClassName = cn('size-4', disabled && 'opacity-40', className)

  if (orientation === 'left') return <ChevronLeft className={iconClassName} {...props} />
  if (orientation === 'right') return <ChevronRight className={iconClassName} {...props} />
  if (orientation === 'up') return <ChevronUp className={iconClassName} {...props} />
  return <ChevronDown className={iconClassName} {...props} />
}

export { Calendar }
