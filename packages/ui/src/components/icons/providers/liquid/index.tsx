import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LiquidAvatar } from './avatar'
import { LiquidDark } from './dark'
import { LiquidLight } from './light'

const Liquid = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LiquidLight className={cn('dark:hidden', className)} {...props} />
    <LiquidDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LiquidIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Liquid, {
  Light: LiquidLight,
  Dark: LiquidDark,
  Avatar: LiquidAvatar,
  colorPrimary: '#000000'
})

export default LiquidIcon
