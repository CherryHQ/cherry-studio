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
        'group relative box-content cursor-pointer peer inline-flex shrink-0 items-center rounded-full shadow-xs outline-none transition-all',
        'data-[state=unchecked]:bg-gray-500/20 data-[state=checked]:bg-primary',
        'hover:bg-primary-hover!',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        {
          'w-9 h-5': size === 'sm',
          'w-11 h-5.5': size === 'md',
          'w-11 h-6': size === 'lg'
        },
        loading && 'data-[state=unchecked]:bg-primary',
        className
      )}
      disabled={disabled}
      {...props}>
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'cs-switch cs-switch-thumb',
          'pointer-events-none block rounded-full bg-background ring-0 transition-all data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground',
          // TODO: not final
          {
            'size-4.5 ml-[1px] data-[state=checked]:translate-x-4': size === 'sm',
            'size-5 ml-[1px] data-[state=checked]:translate-x-5.5': size === 'md',
            'size-5 ml-0.5 data-[state=checked]:translate-x-5': size === 'lg'
          },
          {
            'size-3.5 ml-[3px] data-[state=checked]:translate-x-4.5': loading && size === 'sm',
            'size-4 ml-[3px] data-[state=checked]:translate-x-5.5': loading && size === 'md',
            'size-[17px] ml-[3px] data-[state=checked]:translate-x-5.5': loading && size === 'lg'
          }
          // TODO: Add disabled style
        )}>
        <div
          className={cn(
            'cs-switch cs-switch-thumb-content-container',
            'w-full h-full flex items-center justify-center'
          )}>
          <div
            // TODO: use linear primary
            className={cn(
              'cs-switch cs-switch-thumb-content',
              'w-0.5 h-1.5 rounded-2xl transition-colors group-data-[state=unchecked]:bg-gray-500/20',
              'group-data-[state=checked]:bg-linear-to-b group-data-[state=checked]:from-[#8DE59E] group-data-[state=checked]:to-[#3CD45A]',
              disabled && 'opacity-40',
              loading &&
                'group-data-[state=unchecked]:bg-gray-500/20 group-data-[state=checked]:bg-gray-500/20 animate-spin'
            )}></div>
        </div>
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
    // TODO: spacing 3xs
    <div className={cn('flex w-full gap-3 justify-between', isLeftSide && 'flex-row-reverse')}>
      {/* TODO: spacing 5xs */}
      <label
        className={cn('flex flex-col gap-5xs cursor-pointer', {
          'h-7': description === undefined,
          'h-18': description !== undefined
        })}
        htmlFor={id}>
        {/* TODO: use standard typography component */}
        <p className="leading-7">{label}</p>
        {/* TODO: use standard typography component */}
        {description && <span className="text-secondary-foreground">{description}</span>}
      </label>
      <div className="pt-5xs h-7 flex-col flex justify-start">
        <CustomizedSwitch id={id} {...props} />
      </div>
    </div>
  )
}

CustomizedSwitch.displayName = 'Switch'

export { DescriptionSwitch, CustomizedSwitch as Switch }
export type { CustomSwitchProps as SwitchProps }
