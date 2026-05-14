import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LmstudioAvatar } from './avatar'
import { LmstudioLight } from './light'

const Lmstudio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LmstudioLight {...props} className={className} />
  return <LmstudioLight {...props} className={className} />
}

export const LmstudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lmstudio, {
  Avatar: LmstudioAvatar,
  colorPrimary: '#000000'
})

export default LmstudioIcon
