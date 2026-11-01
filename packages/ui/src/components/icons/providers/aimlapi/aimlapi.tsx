import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AimlapiAvatar } from './avatar'
import { AimlapiLight } from './light'

const Aimlapi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AimlapiLight {...props} className={className} />
  return <AimlapiLight {...props} className={className} />
}

export const AimlapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aimlapi, {
  Avatar: AimlapiAvatar,
  colorPrimary: '#F8F8F8'
})

export default AimlapiIcon
