import type { SwitchProps } from '@heroui/react'
import { Spinner, Switch } from '@heroui/react'

// Enhanced Switch component with loading state support
// FIXME: Implementing the loading animation requires the thumbIcon property.
//        When isLoading is selected, external overriding of this style should not be allowed.
//        This approach is relatively simple to implement, but it lacks some flexibility.
type CustomSwitchProps =
  | (SwitchProps & {
      isLoading: boolean
      thumbIcon?: never
    })
  | (SwitchProps & {
      isLoading?: never
      thumbIcon: SwitchProps['thumbIcon']
    })
  | (SwitchProps & {
      isLoading?: never
      thumbIcon?: never
    })

const CustomizedSwitch = ({ isLoading, children, ref, thumbIcon, ...props }: CustomSwitchProps) => {
  const finalThumbIcon = isLoading ? <Spinner size="sm" /> : thumbIcon

  return (
    <Switch ref={ref} {...props} thumbIcon={finalThumbIcon}>
      {children}
    </Switch>
  )
}

CustomizedSwitch.displayName = 'Switch'

export { CustomizedSwitch as Switch }
export type { CustomSwitchProps as SwitchProps }
