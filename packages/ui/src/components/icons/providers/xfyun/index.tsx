import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XfyunAvatar } from './avatar'
import { XfyunLight } from './light'

const Xfyun = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XfyunLight {...props} className={className} />
  return <XfyunLight {...props} className={className} />
}

export const XfyunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xfyun, {
  Avatar: XfyunAvatar,
  colorPrimary: '#3DC8F9'
})

export default XfyunIcon
