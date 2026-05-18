import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LanyunAvatar } from './avatar'
import { LanyunLight } from './light'

const Lanyun = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LanyunLight {...props} className={className} />
  return <LanyunLight {...props} className={className} />
}

export const LanyunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lanyun, {
  Avatar: LanyunAvatar,
  colorPrimary: '#000000'
})

export default LanyunIcon
