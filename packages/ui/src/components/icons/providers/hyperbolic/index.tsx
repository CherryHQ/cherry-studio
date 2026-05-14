import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { HyperbolicAvatar } from './avatar'
import { HyperbolicDark } from './dark'
import { HyperbolicLight } from './light'

const Hyperbolic = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <HyperbolicLight className={cn('dark:hidden', className)} {...props} />
    <HyperbolicDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const HyperbolicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hyperbolic, {
  Light: HyperbolicLight,
  Dark: HyperbolicDark,
  Avatar: HyperbolicAvatar,
  colorPrimary: '#594CE9'
})

export default HyperbolicIcon
