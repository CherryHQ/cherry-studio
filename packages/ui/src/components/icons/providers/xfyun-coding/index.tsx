import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XfyunCodingAvatar } from './avatar'
import { XfyunCodingLight } from './light'

const XfyunCoding = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XfyunCodingLight {...props} className={className} />
  return <XfyunCodingLight {...props} className={className} />
}

export const XfyunCodingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(XfyunCoding, {
  Avatar: XfyunCodingAvatar,
  colorPrimary: '#3DC8F9'
})

export default XfyunCodingIcon
