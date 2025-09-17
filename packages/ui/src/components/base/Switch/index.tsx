import { Spinner, Switch } from '@heroui/react'

// Enhanced Switch component with loading state support
const CustomizedSwitch = ({
  isLoading,
  children,
  isDisabled,
  ...props
}: React.ComponentProps<typeof Switch> & {
  isLoading?: boolean
}) => {
  return (
    <Switch {...props} isDisabled={isDisabled || isLoading} thumbIcon={isLoading ? <Spinner size="sm" /> : undefined}>
      {children}
    </Switch>
  )
}

CustomizedSwitch.displayName = 'Switch'

export { CustomizedSwitch as Switch }
