import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WenxinAvatar } from './avatar'
import { WenxinLight } from './light'

const Wenxin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WenxinLight {...props} className={className} />
  return <WenxinLight {...props} className={className} />
}

export const WenxinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Wenxin, {
  Avatar: WenxinAvatar,
  colorPrimary: '#012F8D'
})

export default WenxinIcon
