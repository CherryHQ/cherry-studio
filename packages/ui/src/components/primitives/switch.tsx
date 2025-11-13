import { cn } from '@cherrystudio/ui/utils'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as React from 'react'
import { useId } from 'react'

// Enhanced Switch component with loading state support
interface CustomSwitchProps extends Omit<React.ComponentProps<typeof SwitchPrimitive.Root>, 'children'> {
  /** When true, displays a loading animation in the switch thumb. Defaults to false when undefined. */
  loading?: boolean
  size?: 'sm' | 'md' | 'lg'
}

function CustomizedSwitch({ loading = false, disabled = false, size = 'md', className, ...props }: CustomSwitchProps) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'cs-switch cs-switch-root',
        'group relative cursor-pointer peer inline-flex shrink-0 items-center rounded-full shadow-xs outline-none transition-all',
        'data-[state=unchecked]:bg-gray-500/20 data-[state=checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-40',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        {
          'w-9 h-5': size === 'sm',
          'w-11 h-5.5': size === 'md',
          'w-11 h-6': size === 'lg'
        },
        loading && 'bg-primary-hover!',
        className
      )}
      disabled={disabled}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'cs-switch cs-switch-thumb',
          'pointer-events-none block rounded-full ring-0 transition-all data-[state=unchecked]:translate-x-0',
          {
            'size-4.5 ml-[1px] data-[state=checked]:translate-x-4': size === 'sm',
            'size-[19px] ml-0.5 data-[state=checked]:translate-x-[21px]': size === 'md',
            'size-5 ml-[3px] data-[state=checked]:translate-x-4.5': size === 'lg'
          },
          {
            'size-3.5 ml-0.5 data-[state=checked]:translate-x-4.5': loading && size === 'sm',
            'size-4 ml-1 data-[state=checked]:translate-x-5': loading && size === 'md',
            'size-4.5 ml-1 data-[state=checked]:translate-x-4.5': loading && size === 'lg'
          }
        )}>
        <svg
          width="inherit"
          height="inherit"
          viewBox="0 0 19 19"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={cn('transition-all', loading && 'animate-spin')}>
          <path
            d="M9.5 0C14.7467 0 19 4.25329 19 9.5C19 14.7467 14.7467 19 9.5 19C4.25329 19 0 14.7467 0 9.5C0 4.25329 4.25329 0 9.5 0ZM9.5 6.33301C8.91711 6.33301 8.44445 6.8058 8.44434 7.38867V11.6113C8.44445 12.1942 8.91711 12.667 9.5 12.667C10.0829 12.667 10.5555 12.1942 10.5557 11.6113V7.38867C10.5555 6.8058 10.0829 6.33301 9.5 6.33301Z"
            fill="white"
          />
        </svg>
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}

interface DescriptionSwitchProps extends CustomSwitchProps {
  /** Text label displayed next to the switch. */
  label: string
  /** Optional helper text shown below the label. */
  description?: string
  /** Switch position relative to label. Defaults to 'right'. */
  position?: 'left' | 'right'
}

// TODO: It's not finished. We need to use Typography components instead of native html element.
const DescriptionSwitch = ({ label, description, position = 'right', ...props }: DescriptionSwitchProps) => {
  const isLeftSide = position === 'left'
  const id = useId()
  return (
    <div className={cn('flex w-full gap-3 justify-between p-4xs', isLeftSide && 'flex-row-reverse')}>
      <label className={cn('flex flex-col gap-5xs cursor-pointer')} htmlFor={id}>
        {/* TODO: use standard typography component */}
        <p className="text-lg leading-5.5">{label}</p>
        {/* TODO: use standard typography component */}
        {description && <span className="text-foreground-secondary text-sm leading-4">{description}</span>}
      </label>
      <div className="pt-5xs flex justify-center items-center">
        <CustomizedSwitch id={id} {...props} />
      </div>
    </div>
  )
}

CustomizedSwitch.displayName = 'Switch'

export { DescriptionSwitch, CustomizedSwitch as Switch }
export type { CustomSwitchProps as SwitchProps }
