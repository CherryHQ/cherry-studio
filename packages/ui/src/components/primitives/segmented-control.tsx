import { cn } from '@cherrystudio/ui/lib/utils'
import * as React from 'react'

export interface SegmentedControlOption<TValue extends string = string> {
  value: TValue
  label: React.ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<TValue extends string = string>
  extends Omit<React.ComponentPropsWithoutRef<'div'>, 'defaultValue' | 'onChange'> {
  options: readonly SegmentedControlOption<TValue>[]
  value?: TValue
  defaultValue?: TValue
  onValueChange?: (value: TValue) => void
  disabled?: boolean
  size?: 'sm' | 'default'
}

function SegmentedControl<TValue extends string = string>({
  options,
  value,
  defaultValue,
  onValueChange,
  disabled = false,
  size = 'default',
  className,
  ...props
}: SegmentedControlProps<TValue>) {
  const [internalValue, setInternalValue] = React.useState<TValue | undefined>(defaultValue ?? options[0]?.value)
  const selectedValue = value ?? internalValue

  const handleSelect = (option: SegmentedControlOption<TValue>) => {
    if (disabled || option.disabled || option.value === selectedValue) {
      return
    }

    if (value === undefined) {
      setInternalValue(option.value)
    }
    onValueChange?.(option.value)
  }

  return (
    <div
      role="radiogroup"
      data-slot="segmented-control"
      data-size={size}
      aria-disabled={disabled}
      className={cn(
        'inline-flex items-center rounded-full border border-border/60 bg-muted/60 p-0.5',
        disabled && 'pointer-events-none opacity-50',
        className
      )}
      {...props}>
      {options.map((option) => {
        const selected = option.value === selectedValue

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || option.disabled}
            onClick={() => handleSelect(option)}
            className={cn(
              'inline-flex min-w-0 items-center justify-center rounded-full font-medium text-foreground-muted outline-none transition-[background-color,color,box-shadow]',
              'hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
              size === 'sm' ? 'h-7 gap-1.5 px-2.5 text-xs' : 'h-8 gap-2 px-3 text-sm',
              selected && 'bg-background text-foreground shadow-xs'
            )}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
