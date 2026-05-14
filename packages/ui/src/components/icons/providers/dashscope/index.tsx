import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { DashscopeAvatar } from './avatar'
import { DashscopeDark } from './dark'
import { DashscopeLight } from './light'

const Dashscope = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <DashscopeLight className={cn('dark:hidden', className)} {...props} />
    <DashscopeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const DashscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dashscope, {
  Light: DashscopeLight,
  Dark: DashscopeDark,
  Avatar: DashscopeAvatar,
  colorPrimary: '#000000'
})

export default DashscopeIcon
