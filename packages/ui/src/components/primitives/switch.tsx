import { cn } from '@cherrystudio/ui/lib/utils'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cva } from 'class-variance-authority'
import * as React from 'react'
import { useId } from 'react'

const switchRootVariants = cva(
  [
    'cs-switch cs-switch-root',
    'peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none',
    'data-[state=checked]:bg-[var(--color-primary)] data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    'disabled:cursor-not-allowed disabled:opacity-50'
  ],
  {
    variants: {
      size: {
        sm: ['h-3.5 w-6'],
        default: ['h-[1.15rem] w-8']
      },
      loading: {
        false: null,
        true: ['cursor-progress']
      }
    },
    defaultVariants: {
      size: 'default',
      loading: false
    }
  }
)

const switchThumbVariants = cva(
  [
    'cs-switch cs-switch-thumb',
    'pointer-events-none block rounded-full bg-background ring-0 transition-transform',
    'data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0',
    'dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground'
  ],
  {
    variants: {
      size: {
        sm: ['size-3'],
        default: ['size-4']
      },
      loading: {
        false: null,
        true: null
      }
    },
    defaultVariants: {
      size: 'default',
      loading: false
    }
  }
)

type SwitchSize = 'xs' | 'sm' | 'md' | 'lg' | 'default'
type ShadcnSwitchSize = 'sm' | 'default'

/**
 * Maps legacy SwitchSize values to shadcn-compatible sizes.
 * @deprecated xs maps to sm. Use sm directly.
 * @deprecated lg maps to default. Use md or default directly.
 * @deprecated default maps to default. Use md or default explicitly.
 */
const shadcnSwitchSizeBySize: Record<SwitchSize, ShadcnSwitchSize> = {
  xs: 'sm',
  sm: 'default',
  md: 'default',
  lg: 'default',
  default: 'default'
}

interface SwitchProps extends Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, 'children'> {
  /** When true, adds cursor-progress and a data-loading attribute to indicate a loading state. Defaults to false when undefined. */
  loading?: boolean
  size?: SwitchSize
  classNames?: {
    root?: string
    thumb?: string
    /** @deprecated The shadcn Switch thumb no longer renders an internal SVG. */
    thumbSvg?: string
  }
}

function Switch({ loading = false, size = 'default', className, classNames, ...props }: SwitchProps) {
  const shadcnSize = shadcnSwitchSizeBySize[size]

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={shadcnSize}
      data-loading={loading ? true : undefined}
      className={cn(switchRootVariants({ size: shadcnSize, loading }), className, classNames?.root)}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(switchThumbVariants({ size: shadcnSize, loading }), classNames?.thumb)}
      />
    </SwitchPrimitive.Root>
  )
}

interface DescriptionSwitchProps extends Omit<SwitchProps, 'size'> {
  /** Text label displayed next to the switch. */
  label: string
  /** Optional helper text shown below the label. */
  description?: string
  /** Switch position relative to label. Defaults to 'right'. */
  position?: 'left' | 'right'
  size?: 'sm' | 'md' | 'lg'
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
    <div className={cn('flex w-full gap-3 justify-between p-4xs', isLeftSide && 'flex-row-reverse')}>
      <label className={cn('flex flex-col gap-5xs cursor-pointer')} htmlFor={id}>
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
