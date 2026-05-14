import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { RiverflowAvatar } from './avatar'
import { RiverflowDark } from './dark'
import { RiverflowLight } from './light'

const Riverflow = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <RiverflowLight className={cn('dark:hidden', className)} {...props} />
    <RiverflowDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const RiverflowIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Riverflow, {
  Light: RiverflowLight,
  Dark: RiverflowDark,
  Avatar: RiverflowAvatar,
  colorPrimary: '#1F0909'
})

export default RiverflowIcon
