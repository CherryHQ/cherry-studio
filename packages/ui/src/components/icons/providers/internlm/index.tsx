import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { InternlmAvatar } from './avatar'
import { InternlmDark } from './dark'
import { InternlmLight } from './light'

const Internlm = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <InternlmLight className={cn('dark:hidden', className)} {...props} />
    <InternlmDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const InternlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Internlm, {
  Light: InternlmLight,
  Dark: InternlmDark,
  Avatar: InternlmAvatar,
  colorPrimary: '#858599'
})

export default InternlmIcon
