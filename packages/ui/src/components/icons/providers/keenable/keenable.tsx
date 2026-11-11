import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KeenableAvatar } from './avatar'
import { KeenableLight } from './light'

const Keenable = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KeenableLight {...props} className={className} />
  return <KeenableLight {...props} className={className} />
}

export const KeenableIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Keenable, {
  Avatar: KeenableAvatar,
  colorPrimary: '#2A2A2A'
})

export default KeenableIcon
