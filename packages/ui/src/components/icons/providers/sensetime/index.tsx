import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SensetimeAvatar } from './avatar'
import { SensetimeLight } from './light'

const Sensetime = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SensetimeLight {...props} className={className} />
  return <SensetimeLight {...props} className={className} />
}

export const SensetimeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensetime, {
  Avatar: SensetimeAvatar,
  colorPrimary: '#7680F8'
})

export default SensetimeIcon
