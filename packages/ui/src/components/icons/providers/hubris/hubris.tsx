import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HubrisAvatar } from './avatar'
import { HubrisLight } from './light'

const Hubris = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HubrisLight {...props} className={className} />
  return <HubrisLight {...props} className={className} />
}

export const HubrisIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hubris, {
  Avatar: HubrisAvatar,
  colorPrimary: '#8B6BFF'
})

export default HubrisIcon
