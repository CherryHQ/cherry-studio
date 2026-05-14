import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { StabilityAvatar } from './avatar'
import { StabilityDark } from './dark'
import { StabilityLight } from './light'

const Stability = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <StabilityLight className={cn('dark:hidden', className)} {...props} />
    <StabilityDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const StabilityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Stability, {
  Light: StabilityLight,
  Dark: StabilityDark,
  Avatar: StabilityAvatar,
  colorPrimary: '#E80000'
})

export default StabilityIcon
