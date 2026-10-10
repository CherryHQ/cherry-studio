import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SophnetAvatar } from './avatar'
import { SophnetLight } from './light'

const Sophnet = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SophnetLight {...props} className={className} />
  return <SophnetLight {...props} className={className} />
}

export const SophnetIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sophnet, {
  Avatar: SophnetAvatar,
  colorPrimary: '#6200EE'
})

export default SophnetIcon
