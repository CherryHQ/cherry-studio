import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { ClaudeAvatar } from './avatar'
import { ClaudeDark } from './dark'
import { ClaudeLight } from './light'

const Claude = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <ClaudeLight className={cn('dark:hidden', className)} {...props} />
    <ClaudeDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const ClaudeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Claude, {
  Light: ClaudeLight,
  Dark: ClaudeDark,
  Avatar: ClaudeAvatar,
  colorPrimary: '#d97757'
})

export default ClaudeIcon
