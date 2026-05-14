import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GeminiAvatar } from './avatar'
import { GeminiDark } from './dark'
import { GeminiLight } from './light'

const Gemini = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GeminiLight className={cn('dark:hidden', className)} {...props} />
    <GeminiDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GeminiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemini, {
  Light: GeminiLight,
  Dark: GeminiDark,
  Avatar: GeminiAvatar,
  colorPrimary: '#F6C013'
})

export default GeminiIcon
