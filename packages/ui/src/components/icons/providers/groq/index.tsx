import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GroqAvatar } from './avatar'
import { GroqDark } from './dark'
import { GroqLight } from './light'

const Groq = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GroqLight className={cn('dark:hidden', className)} {...props} />
    <GroqDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GroqIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Groq, {
  Light: GroqLight,
  Dark: GroqDark,
  Avatar: GroqAvatar,
  colorPrimary: '#F54F35'
})

export default GroqIcon
