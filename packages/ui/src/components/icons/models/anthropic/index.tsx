import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AnthropicAvatar } from './avatar'
import { AnthropicLight } from './light'

const Anthropic = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AnthropicLight {...props} className={cn('text-foreground', className)} />
  return <AnthropicLight {...props} className={cn('text-foreground', className)} />
}

export const AnthropicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anthropic, {
  Avatar: AnthropicAvatar,
  colorPrimary: '#000000'
})

export default AnthropicIcon
