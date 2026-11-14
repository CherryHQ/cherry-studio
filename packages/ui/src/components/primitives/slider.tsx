import * as SliderPrimitive from '@radix-ui/react-slider'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

import { cn } from '@cherrystudio/ui/lib/utils'

type SliderMark = {
  value: number
  label: React.ReactNode
}

const sliderTrackVariants = cva(
  cn(
    'relative grow overflow-hidden rounded-full bg-primary/10',
    'data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full'
  ),
  {
    variants: {
      size: {
        sm: 'data-[orientation=horizontal]:h-1 data-[orientation=vertical]:w-1',
        md: 'data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5',
        lg: 'data-[orientation=horizontal]:h-2 data-[orientation=vertical]:w-2'
      }
    },
    defaultVariants: {
      size: 'md'
    }
  }
)

const sliderThumbVariants = cva(
  cn(
    'block shrink-0 rounded-full border border-background bg-primary shadow-xs transition-[color,box-shadow]',
    'ring-primary/30 hover:ring-4 focus-visible:ring-2 focus-visible:outline-hidden focus-visible:ring-inset',
    'disabled:pointer-events-none disabled:opacity-50'
  ),
  {
    variants: {
      size: {
        sm: 'size-3.5',
        md: 'size-4',
        lg: 'size-5'
      }
    },
    defaultVariants: {
      size: 'md'
    }
  }
)

const sliderMarkLabelVariants = cva('absolute top-0 leading-none whitespace-nowrap text-muted-foreground', {
  variants: {
    size: {
      sm: 'text-[10px]',
      md: 'text-xs',
      lg: 'text-sm'
    }
  },
  defaultVariants: {
    size: 'md'
  }
})

const sliderValueLabelVariants = cva(
  cn(
    'pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-full',
    'rounded bg-primary px-1.5 py-0.5 text-primary-foreground',
    'scale-0 opacity-0 transition-all group-hover:scale-100 group-hover:opacity-100'
  ),
  {
    variants: {
      size: {
        sm: '-top-1 text-[10px]',
        md: '-top-1.5 text-xs',
        lg: '-top-2 text-sm'
      }
    },
    defaultVariants: {
      size: 'md'
    }
  }
)

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  step = 1,
  snapOnRelease = false,
  size,
  marks,
  orientation = 'horizontal',
  showValueLabel,
  formatValueLabel,
  getThumbAriaLabel,
  getThumbAriaValueText,
  onValueChange,
  onValueCommit,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> &
  VariantProps<typeof sliderTrackVariants> & {
    /** Single-thumb sliders can track the pointer continuously and settle onto a step on release. */
    snapOnRelease?: boolean
    marks?: SliderMark[]
    showValueLabel?: boolean
    formatValueLabel?: (value: number) => React.ReactNode
    getThumbAriaLabel?: (index: number) => string
    getThumbAriaValueText?: (value: number, index: number) => string
  }) {
  const [localValues, setLocalValues] = React.useState(() =>
    Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]
  )

  React.useEffect(() => {
    if (Array.isArray(value)) {
      setLocalValues(value)
    }
  }, [value])

  const [dragValues, setDragValues] = React.useState<number[] | null>(null)
  const pointerDownRef = React.useRef(false)
  const canSnap = snapOnRelease && localValues.length === 1
  const dragging = canSnap && dragValues !== null
  const snapValues = (values: number[]) =>
    values.map((val) => Math.min(max, Math.max(min, Number((min + Math.round((val - min) / step) * step).toFixed(10)))))
  const isVertical = orientation === 'vertical'

  const sliderElement = (
    <SliderPrimitive.Root
      data-slot="slider"
      data-size={size}
      defaultValue={defaultValue}
      value={dragging ? dragValues : canSnap ? (value ?? localValues) : value}
      step={dragging ? step / 1000 : step}
      data-dragging={dragging || undefined}
      min={min}
      max={max}
      orientation={orientation}
      onValueChange={(newValues) => {
        if (dragging) setDragValues(newValues)
        const nextValues = canSnap ? snapValues(newValues) : newValues
        if (!canSnap || nextValues.some((val, index) => val !== localValues[index])) {
          setLocalValues(nextValues)
          onValueChange?.(nextValues)
        }
      }}
      onValueCommit={(newValues) => onValueCommit?.(canSnap ? snapValues(newValues) : newValues)}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        canSnap && [
          '[&_[data-slot=slider-range]]:transition-[left,right,top,bottom] [&>span:has(>[data-slot=slider-thumb])]:transition-[left,right,top,bottom]',
          '[&_[data-slot=slider-range]]:duration-250 [&>span:has(>[data-slot=slider-thumb])]:duration-250',
          '[&_[data-slot=slider-range]]:ease-[cubic-bezier(0.22,1,0.36,1)] [&>span:has(>[data-slot=slider-thumb])]:ease-[cubic-bezier(0.22,1,0.36,1)]',
          '[&_[data-slot=slider-thumb]]:transition-[scale,box-shadow] [&_[data-slot=slider-thumb]]:duration-150',
          'data-[dragging=true]:[&_[data-slot=slider-range]]:transition-none data-[dragging=true]:[&_[data-slot=slider-thumb]]:scale-110 data-[dragging=true]:[&>span:has(>[data-slot=slider-thumb])]:transition-none',
          'motion-reduce:[&_[data-slot=slider-range]]:transition-none motion-reduce:[&_[data-slot=slider-thumb]]:scale-100 motion-reduce:[&_[data-slot=slider-thumb]]:transition-none motion-reduce:[&>span:has(>[data-slot=slider-thumb])]:transition-none'
        ],
        !marks?.length && className
      )}
      {...props}
      onPointerDownCapture={(event) => {
        props.onPointerDownCapture?.(event)
        if (canSnap && !props.disabled && !event.defaultPrevented && event.button === 0) {
          pointerDownRef.current = true
          if ((event.target as HTMLElement).closest('[data-slot=slider-thumb]')) {
            setDragValues(value ?? localValues)
          }
        }
      }}
      onPointerMoveCapture={(event) => {
        props.onPointerMoveCapture?.(event)
        if (pointerDownRef.current && !dragging && !event.defaultPrevented) {
          setDragValues(value ?? localValues)
        }
      }}
      onPointerUp={(event) => {
        pointerDownRef.current = false
        props.onPointerUp?.(event)
      }}
      onLostPointerCapture={(event) => {
        pointerDownRef.current = false
        setDragValues(null)
        props.onLostPointerCapture?.(event)
      }}
      onPointerCancel={(event) => {
        pointerDownRef.current = false
        setDragValues(null)
        props.onPointerCancel?.(event)
      }}>
      <SliderPrimitive.Track data-slot="slider-track" className={sliderTrackVariants({ size })}>
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn('absolute bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full')}
        />
      </SliderPrimitive.Track>
      {localValues.map((val, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={getThumbAriaLabel?.(index)}
          aria-valuetext={getThumbAriaValueText?.(val, index)}
          className={cn(sliderThumbVariants({ size }), showValueLabel && 'group')}>
          {showValueLabel && (
            <span data-slot="slider-value-label" className={sliderValueLabelVariants({ size })}>
              {formatValueLabel ? formatValueLabel(val) : val}
            </span>
          )}
        </SliderPrimitive.Thumb>
      ))}
    </SliderPrimitive.Root>
  )

  if (!marks?.length) {
    return sliderElement
  }

  return (
    <div
      data-slot="slider-container"
      className={cn('relative', isVertical ? 'flex h-full items-stretch' : '', className)}>
      {sliderElement}
      <div
        data-slot="slider-marks"
        className={cn('relative', isVertical ? 'ml-2 flex h-full flex-col justify-between' : 'mt-1.5 h-4 w-full')}>
        {marks.map((mark) => {
          const range = max - min
          if (range === 0) return null
          const percentage = ((mark.value - min) / range) * 100
          const transform =
            percentage <= 0 ? 'translateX(0)' : percentage >= 100 ? 'translateX(-100%)' : 'translateX(-50%)'
          return (
            <span
              key={mark.value}
              data-slot="slider-mark"
              className={sliderMarkLabelVariants({ size })}
              style={
                isVertical
                  ? { top: `${100 - percentage}%`, transform: 'translateY(-50%)' }
                  : { left: `${percentage}%`, transform }
              }>
              {mark.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export { Slider, type SliderMark }
