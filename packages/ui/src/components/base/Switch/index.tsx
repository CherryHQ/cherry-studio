import type { SwitchProps } from '@heroui/react'
import { Spinner, Switch } from '@heroui/react'

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

CustomizedSwitch.displayName = 'Switch'

export { CustomizedSwitch as Switch }
export type { CustomSwitchProps as SwitchProps }
