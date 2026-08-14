import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BochaAvatar } from './avatar'
import { BochaLight } from './light'

const Bocha = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BochaLight {...props} className={className} />
  return <BochaLight {...props} className={className} />
}

export const BochaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bocha, {
  Avatar: BochaAvatar,
  colorPrimary: '#A5CCFF'
})

export default BochaIcon
