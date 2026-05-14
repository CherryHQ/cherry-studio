import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DatabricksAvatar } from './avatar'
import { DatabricksDark } from './dark'
import { DatabricksLight } from './light'

const Databricks = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DatabricksLight {...props} className={className} />
  if (variant === 'dark') return <DatabricksDark {...props} className={className} />
  return (
    <>
      <DatabricksLight className={cn('dark:hidden', className)} {...props} />
      <DatabricksDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const DatabricksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Databricks, {
  Avatar: DatabricksAvatar,
  colorPrimary: '#FF3621'
})

export default DatabricksIcon
