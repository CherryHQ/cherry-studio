import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GrokAvatar } from './avatar'
import { GrokDark } from './dark'
import { GrokLight } from './light'

const Grok = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GrokLight className={cn('dark:hidden', className)} {...props} />
    <GrokDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GrokIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Grok, {
  Light: GrokLight,
  Dark: GrokDark,
  Avatar: GrokAvatar,
  colorPrimary: '#000000'
})

export default GrokIcon
