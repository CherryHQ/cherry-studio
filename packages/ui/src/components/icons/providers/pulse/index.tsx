import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PulseAvatar } from './avatar'
import { PulseLight } from './light'

const Pulse = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PulseLight {...props} className={className} />
  return <PulseLight {...props} className={className} />
}

export const PulseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Pulse, {
  Avatar: PulseAvatar,
  colorPrimary: '#302F7D'
})

export default PulseIcon
