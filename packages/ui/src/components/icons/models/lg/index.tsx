import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LgAvatar } from './avatar'
import { LgLight } from './light'

const Lg = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LgLight {...props} className={className} />
  return <LgLight {...props} className={className} />
}

export const LgIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lg, {
  Avatar: LgAvatar,
  colorPrimary: '#C00C3F'
})

export default LgIcon
