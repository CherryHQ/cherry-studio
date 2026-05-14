import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XirangAvatar } from './avatar'
import { XirangLight } from './light'

const Xirang = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XirangLight {...props} className={className} />
  return <XirangLight {...props} className={className} />
}

export const XirangIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xirang, {
  Avatar: XirangAvatar,
  colorPrimary: '#DF0428'
})

export default XirangIcon
