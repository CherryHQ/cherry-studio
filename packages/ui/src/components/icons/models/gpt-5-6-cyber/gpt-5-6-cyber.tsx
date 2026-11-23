import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt56CyberAvatar } from './avatar'
import { Gpt56CyberLight } from './light'

const Gpt56Cyber = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt56CyberLight {...props} className={className} />

  return <Gpt56CyberLight {...props} className={className} />
}

export const Gpt56CyberIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt56Cyber, {
  Avatar: Gpt56CyberAvatar,
  colorPrimary: '#000100'
})

export default Gpt56CyberIcon
