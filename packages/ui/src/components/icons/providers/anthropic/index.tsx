import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { AnthropicAvatar } from './avatar'
import { AnthropicDark } from './dark'
import { AnthropicLight } from './light'

const Anthropic = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <AnthropicLight className={cn('dark:hidden', className)} {...props} />
    <AnthropicDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const AnthropicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anthropic, {
  Light: AnthropicLight,
  Dark: AnthropicDark,
  Avatar: AnthropicAvatar,
  colorPrimary: '#CA9F7B'
})

export default AnthropicIcon
