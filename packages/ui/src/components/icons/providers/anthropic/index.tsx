import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AnthropicAvatar } from './avatar'
import { AnthropicLight } from './light'

const Anthropic = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AnthropicLight {...props} className={className} />
  return <AnthropicLight {...props} className={className} />
}

export const AnthropicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anthropic, {
  Avatar: AnthropicAvatar,
  colorPrimary: '#CA9F7B'
})

export default AnthropicIcon
