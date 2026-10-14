import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AimassAvatar } from './avatar'
import { AimassLight } from './light'

const Aimass = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AimassLight {...props} className={className} />
  return <AimassLight {...props} className={className} />
}

export const AimassIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aimass, {
  Avatar: AimassAvatar,
  colorPrimary: '#003E97'
})

export default AimassIcon
