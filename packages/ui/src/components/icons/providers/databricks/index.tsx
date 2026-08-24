import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DatabricksAvatar } from './avatar'
import { DatabricksLight } from './light'

const Databricks = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DatabricksLight {...props} className={className} />
  return <DatabricksLight {...props} className={className} />
}

export const DatabricksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Databricks, {
  Avatar: DatabricksAvatar,
  colorPrimary: '#FF3621'
})

export default DatabricksIcon
