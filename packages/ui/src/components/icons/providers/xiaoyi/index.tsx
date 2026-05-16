import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XiaoyiAvatar } from './avatar'
import { XiaoyiLight } from './light'

const Xiaoyi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XiaoyiLight {...props} className={className} />
  return <XiaoyiLight {...props} className={className} />
}

export const XiaoyiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xiaoyi, {
  Avatar: XiaoyiAvatar,
  colorPrimary: '#000000'
})

export default XiaoyiIcon
