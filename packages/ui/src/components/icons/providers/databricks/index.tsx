import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DatabricksAvatar } from './avatar'
import { DatabricksDark } from './dark'
import { DatabricksLight } from './light'

const Databricks = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DatabricksLight className={cn('dark:hidden', className)} {...props} />
    <DatabricksDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DatabricksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Databricks, {
  Light: DatabricksLight,
  Dark: DatabricksDark,
  Avatar: DatabricksAvatar,
  colorPrimary: '#FF3621'
})

export default DatabricksIcon
