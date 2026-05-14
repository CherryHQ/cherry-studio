import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { GemmaAvatar } from './avatar'
import { GemmaDark } from './dark'
import { GemmaLight } from './light'

const Gemma = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <GemmaLight className={cn('dark:hidden', className)} {...props} />
    <GemmaDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const GemmaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemma, {
  Light: GemmaLight,
  Dark: GemmaDark,
  Avatar: GemmaAvatar,
  colorPrimary: '#53A3FF'
})

export default GemmaIcon
