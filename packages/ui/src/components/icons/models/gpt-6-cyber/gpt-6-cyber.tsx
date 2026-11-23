import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt6CyberAvatar } from './avatar'
import { Gpt6CyberLight } from './light'

const Gpt6Cyber = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt6CyberLight {...props} className={className} />

  return <Gpt6CyberLight {...props} className={className} />
}

export const Gpt6CyberIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt6Cyber, {
  Avatar: Gpt6CyberAvatar,
  colorPrimary: '#020101'
})

export default Gpt6CyberIcon
