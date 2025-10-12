import type { SwitchProps } from '@heroui/react'
import { cn, Spinner, Switch } from '@heroui/react'

// Enhanced Switch component with loading state support
interface CustomSwitchProps extends SwitchProps {
  isLoading?: boolean
}

/**
 * A customized Switch component based on HeroUI Switch
 * @see https://www.heroui.com/docs/components/switch#api
 * @param isLoading When true, displays a loading spinner in the switch thumb
 */
const CustomizedSwitch = ({ isLoading, children, ref, thumbIcon, ...props }: CustomSwitchProps) => {
  const finalThumbIcon = isLoading ? <Spinner size="sm" /> : thumbIcon

  return (
    <Switch ref={ref} {...props} thumbIcon={finalThumbIcon}>
      {children}
    </Switch>
  )
}

const DescriptionSwitch = ({ children, ...props }: CustomSwitchProps) => {
  return (
    <CustomizedSwitch
      size="sm"
      classNames={{
        base: cn(
          'inline-flex w-full max-w-md flex-row-reverse items-center hover:bg-content2',
          'cursor-pointer justify-between gap-2 rounded-lg border-2 border-transparent py-2 pr-1',
          'data-[selected=true]:border-primary',
        ),
        wrapper: 'p-0 h-4 overflow-visible',
        thumb: cn(
          'h-6 w-6 border-2 shadow-lg',
          'group-data-[hover=true]:border-primary',
          //selected
          'group-data-[selected=true]:ms-6',
          // pressed
          'group-data-[pressed=true]:w-7',
          'group-data-pressed:group-data-selected:ms-4'
        )
      }}
      {...props}>
      {children}
    </CustomizedSwitch>
  )
}

CustomizedSwitch.displayName = 'Switch'

export { DescriptionSwitch, CustomizedSwitch as Switch }
export type { CustomSwitchProps as SwitchProps }
