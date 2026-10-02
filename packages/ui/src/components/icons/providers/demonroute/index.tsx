import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DemonrouteAvatar } from './avatar'
import { DemonrouteLight } from './light'

const Demonroute = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DemonrouteLight {...props} className={className} />
  return <DemonrouteLight {...props} className={className} />
}

export const DemonrouteIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Demonroute, {
  Avatar: DemonrouteAvatar,
  colorPrimary: '#000000'
})

export default DemonrouteIcon
