import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HyperbolicAvatar } from './avatar'
import { HyperbolicLight } from './light'

const Hyperbolic = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HyperbolicLight {...props} className={className} />
  return <HyperbolicLight {...props} className={className} />
}

export const HyperbolicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hyperbolic, {
  Avatar: HyperbolicAvatar,
  colorPrimary: '#594CE9'
})

export default HyperbolicIcon
