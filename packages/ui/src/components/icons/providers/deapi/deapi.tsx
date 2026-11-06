import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DeapiAvatar } from './avatar'
import { DeapiLight } from './light'

const Deapi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DeapiLight {...props} className={className} />
  return <DeapiLight {...props} className={className} />
}

export const DeapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deapi, {
  Avatar: DeapiAvatar,
  colorPrimary: '#18181B'
})

export default DeapiIcon
