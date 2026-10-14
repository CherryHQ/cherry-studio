import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FireworksAvatar } from './avatar'
import { FireworksLight } from './light'

const Fireworks = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FireworksLight {...props} className={className} />
  return <FireworksLight {...props} className={className} />
}

export const FireworksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fireworks, {
  Avatar: FireworksAvatar,
  colorPrimary: '#5019C5'
})

export default FireworksIcon
