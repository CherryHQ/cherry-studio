import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ZeroOneAvatar } from './avatar'
import { ZeroOneLight } from './light'

const ZeroOne = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ZeroOneLight {...props} className={className} />
  return <ZeroOneLight {...props} className={className} />
}

export const ZeroOneIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZeroOne, {
  Avatar: ZeroOneAvatar,
  colorPrimary: '#133426'
})

export default ZeroOneIcon
