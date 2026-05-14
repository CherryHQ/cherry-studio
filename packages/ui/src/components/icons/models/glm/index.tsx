import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GlmAvatar } from './avatar'
import { GlmDark } from './dark'
import { GlmLight } from './light'

const Glm = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GlmLight className={cn('dark:hidden', className)} {...props} />
    <GlmDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glm, {
  Light: GlmLight,
  Dark: GlmDark,
  Avatar: GlmAvatar,
  colorPrimary: '#5072E9'
})

export default GlmIcon
