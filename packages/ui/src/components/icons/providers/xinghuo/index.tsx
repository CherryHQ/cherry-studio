import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XinghuoAvatar } from './avatar'
import { XinghuoLight } from './light'

const Xinghuo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XinghuoLight {...props} className={className} />
  return <XinghuoLight {...props} className={className} />
}

export const XinghuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xinghuo, {
  Avatar: XinghuoAvatar,
  colorPrimary: '#3DC8F9'
})

export default XinghuoIcon
