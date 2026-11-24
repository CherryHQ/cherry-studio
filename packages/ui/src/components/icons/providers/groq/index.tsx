import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GroqAvatar } from './avatar'
import { GroqLight } from './light'

const Groq = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GroqLight {...props} className={className} />
  return <GroqLight {...props} className={className} />
}

export const GroqIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Groq, {
  Avatar: GroqAvatar,
  colorPrimary: '#f54f35'
})

export default GroqIcon
