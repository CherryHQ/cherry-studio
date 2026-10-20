import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StabilityAvatar } from './avatar'
import { StabilityLight } from './light'

const Stability = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StabilityLight {...props} className={className} />
  return <StabilityLight {...props} className={className} />
}

export const StabilityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Stability, {
  Avatar: StabilityAvatar,
  colorPrimary: '#E80000'
})

export default StabilityIcon
