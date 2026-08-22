import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DotsAvatar } from './avatar'
import { DotsLight } from './light'

const Dots = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DotsLight {...props} className={className} />
  return <DotsLight {...props} className={className} />
}

export const DotsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dots, {
  Avatar: DotsAvatar,
  colorPrimary: '#0A0A0A'
})

export default DotsIcon
