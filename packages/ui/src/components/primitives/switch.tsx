import { cn } from '@cherrystudio/ui/lib/utils'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cva } from 'class-variance-authority'
import { LoaderCircle } from 'lucide-react'
import * as React from 'react'
import { useId } from 'react'

const switchRootVariants = cva(
  [
    'cs-switch cs-switch-root',
    'group relative cursor-pointer peer inline-flex shrink-0 items-center rounded-full shadow-xs outline-none transition-all',
    'data-[state=unchecked]:bg-[color:color-mix(in_srgb,var(--color-foreground)_15%,transparent)] data-[state=checked]:bg-primary',
    'disabled:cursor-not-allowed disabled:opacity-40',
    'focus-visible:border-ring focus-visible:ring-[1px] focus-visible:ring-ring/35'
  ],
  {
    variants: {
      size: {
        xs: ['h-3.5 w-6'],
        sm: ['h-4 w-7'],
        md: ['h-4.5 w-8'],
        lg: ['h-5 w-9']
      },
      loading: {
        false: null,
        true: ['bg-primary/60!']
      }
    },
    defaultVariants: {
      size: 'md',
      loading: false
    }
  }
)

const switchThumbVariants = cva(
  [
    'cs-switch cs-switch-thumb',
    'pointer-events-none block rounded-full ring-0 transition-all data-[state=unchecked]:translate-x-0'
  ],
  {
    variants: {
      size: {
        xs: ['size-3 ml-[1px] data-[state=checked]:translate-x-2.5'],
        sm: ['size-3.5 ml-[1px] data-[state=checked]:translate-x-3'],
        md: ['size-4 ml-[1px] data-[state=checked]:translate-x-3.5'],
        lg: ['size-4.5 ml-[1px] data-[state=checked]:translate-x-4']
      }
    }
  }
)

// Enhanced Switch component with loading state support
interface SwitchProps extends Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, 'children'> {
  /** When true, dims the switch to indicate an in-flight state. Defaults to false when undefined. */
  loading?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
  classNames?: {
    root?: string
    thumb?: string
    thumbSvg?: string
  }
}

function Switch({ loading = false, size = 'md', className, classNames, ...props }: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(switchRootVariants({ size, loading }), className, classNames?.root)}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn('bg-background', switchThumbVariants({ size }), classNames?.thumb)}>
        <LoaderCircle
          aria-hidden="true"
          strokeWidth={1.6}
          className={cn(
            'size-full p-0.5 text-primary transition-opacity',
            loading ? 'animate-spin opacity-100' : 'opacity-0',
            classNames?.thumbSvg
          )}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}

interface DescriptionSwitchProps extends SwitchProps {
  /** Text label displayed next to the switch. */
  label: string
  /** Optional helper text shown below the label. */
  description?: string
  /** Switch position relative to label. Defaults to 'right'. */
  position?: 'left' | 'right'
}

// TODO: It's not finished. We need to use Typography components instead of native html element.
const DescriptionSwitch = ({
  label,
  description,
  position = 'right',
  size = 'md',
  ...props
}: DescriptionSwitchProps) => {
  const isLeftSide = position === 'left'
  const id = useId()
  return (
    <div className={cn('flex w-full gap-3 justify-between p-2', isLeftSide && 'flex-row-reverse')}>
      <label className={cn('flex flex-col gap-1 cursor-pointer')} htmlFor={id}>
        {/* TODO: use standard typography component */}
        <p
          className={cn(
            'font-medium tracking-normal',
            {
              'text-sm leading-4': size === 'sm',
              'text-md leading-4.5': size === 'md',
              'text-lg leading-5.5': size === 'lg'
            },
            isLeftSide && 'text-right'
          )}>
          {label}
        </p>
        {/* TODO: use standard typography component */}
        {description && (
          <span
            className={cn('text-foreground-secondary', {
              'text-[10px] leading-3': size === 'sm',
              'text-xs leading-3.5': size === 'md',
              'text-sm leading-4': size === 'lg'
            })}>
            {description}
          </span>
        )}
      </label>
      <div className="flex justify-center items-center">
        <Switch id={id} size={size} {...props} />
      </div>
    </div>
  )
}

Switch.displayName = 'Switch'

export { DescriptionSwitch, Switch }
export type { SwitchProps }
