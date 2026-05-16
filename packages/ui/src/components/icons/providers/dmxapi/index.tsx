import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DmxapiAvatar } from './avatar'
import { DmxapiLight } from './light'

const Dmxapi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DmxapiLight {...props} className={className} />
  return <DmxapiLight {...props} className={className} />
}

export const DmxapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dmxapi, {
  Avatar: DmxapiAvatar,
  colorPrimary: '#924C88'
})

export default DmxapiIcon
