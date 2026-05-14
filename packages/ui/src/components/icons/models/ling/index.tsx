import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { LingAvatar } from './avatar'
import { LingDark } from './dark'
import { LingLight } from './light'

const Ling = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <LingLight className={cn('dark:hidden', className)} {...props} />
    <LingDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const LingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ling, {
  Light: LingLight,
  Dark: LingDark,
  Avatar: LingAvatar,
  colorPrimary: '#0C73FF'
})

export default LingIcon
