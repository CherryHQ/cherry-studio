import { cn } from '@cherrystudio/ui/utils/index'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

type SliderMark = {
  value: number
  label: React.ReactNode
}

const sliderVariants = cva('', {
  variants: {
    size: {
      sm: '',
      default: '',
      lg: ''
    }
  },
  defaultVariants: {
    size: 'default'
  }
})

const sliderTrackVariants = cva(
  cn(
    'bg-primary/10 relative grow overflow-hidden rounded-full',
    'data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full'
  ),
  {
    variants: {
      size: {
        sm: 'data-[orientation=horizontal]:h-1 data-[orientation=vertical]:w-1',
        default: 'data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5',
        lg: 'data-[orientation=horizontal]:h-2 data-[orientation=vertical]:w-2'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

const sliderThumbVariants = cva(
  cn(
    'block shrink-0 rounded-full border border-primary/40 bg-background shadow-sm transition-[color,box-shadow]',
    'ring-primary/30 hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden',
    'disabled:pointer-events-none disabled:opacity-50'
  ),
  {
    variants: {
      size: {
        sm: 'size-3.5',
        default: 'size-4',
        lg: 'size-5'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

const sliderMarkLabelVariants = cva('absolute text-muted-foreground', {
  variants: {
    size: {
      sm: 'text-[10px]',
      default: 'text-xs',
      lg: 'text-sm'
    }
  },
  defaultVariants: {
    size: 'default'
  }
})

const sliderValueLabelVariants = cva(
  cn(
    'absolute left-1/2 -translate-x-1/2 -translate-y-full pointer-events-none',
    'rounded bg-primary px-1.5 py-0.5 text-primary-foreground',
    'scale-0 opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100'
  ),
  {
    variants: {
      size: {
        sm: 'text-[10px] -top-1',
        default: 'text-xs -top-1.5',
        lg: 'text-sm -top-2'
      }
    },
    defaultVariants: {
      size: 'default'
    }
  }
)

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  size,
  marks,
  orientation = 'horizontal',
  showValueLabel,
  formatValueLabel,
  onValueChange,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> &
  VariantProps<typeof sliderVariants> & {
    marks?: SliderMark[]
    showValueLabel?: boolean
    formatValueLabel?: (value: number) => React.ReactNode
  }) {
  const initialValues = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const [internalValues, setInternalValues] = React.useState(initialValues)
  const currentValues = value ?? internalValues

  const handleValueChange = React.useCallback(
    (newValues: number[]) => {
      if (!value) {
        setInternalValues(newValues)
      }
      onValueChange?.(newValues)
    },
    [value, onValueChange]
  )

  const isVertical = orientation === 'vertical'

  const sliderElement = (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      orientation={orientation}
      onValueChange={handleValueChange}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        sliderVariants({ size }),
        (!marks || marks.length === 0) && className
      )}
      {...props}>
      <SliderPrimitive.Track data-slot="slider-track" className={sliderTrackVariants({ size })}>
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn('bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full')}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: currentValues.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className={cn(sliderThumbVariants({ size }), showValueLabel && 'group')}>
          {showValueLabel && (
            <span data-slot="slider-value-label" className={sliderValueLabelVariants({ size })}>
              {formatValueLabel ? formatValueLabel(currentValues[index]) : currentValues[index]}
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )

  if (!marks || marks.length === 0) {
    return sliderElement
  }

  return (
    <div
      data-slot="slider-container"
      className={cn('relative', isVertical ? 'flex h-full items-stretch' : '', className)}>
      {sliderElement}
      <div
        data-slot="slider-marks"
        className={cn('relative', isVertical ? 'ml-2 flex h-full flex-col justify-between' : 'mt-1.5 w-full')}>
        {marks.map((mark, index) => {
          const percentage = ((mark.value - min) / (max - min)) * 100
          return (
            <span
              key={index}
              data-slot="slider-mark"
              className={sliderMarkLabelVariants({ size })}
              style={
                isVertical
                  ? { top: `${100 - percentage}%`, transform: 'translateY(-50%)' }
                  : { left: `${percentage}%`, transform: 'translateX(-50%)' }
              }>
              {mark.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export { Slider, type SliderMark, sliderVariants }
