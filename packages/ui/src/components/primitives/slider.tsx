import { cn } from '@cherrystudio/ui/utils/index'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'

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

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  size,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & VariantProps<typeof sliderVariants>) {
  const _values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        sliderVariants({ size }),
        className
      )}
      {...props}>
      <SliderPrimitive.Track data-slot="slider-track" className={sliderTrackVariants({ size })}>
        <SliderPrimitive.Range
          data-slot="slider-range"
          className={cn('bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full')}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb data-slot="slider-thumb" key={index} className={sliderThumbVariants({ size })} />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider, sliderVariants }
