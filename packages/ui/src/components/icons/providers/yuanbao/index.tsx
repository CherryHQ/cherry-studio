import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { YuanbaoAvatar } from './avatar'
import { YuanbaoDark } from './dark'
import { YuanbaoLight } from './light'

const Yuanbao = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <YuanbaoLight className={cn('dark:hidden', className)} {...props} />
    <YuanbaoDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const YuanbaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Yuanbao, {
  Light: YuanbaoLight,
  Dark: YuanbaoDark,
  Avatar: YuanbaoAvatar,
  colorPrimary: '#38CF6F'
})

export default YuanbaoIcon
