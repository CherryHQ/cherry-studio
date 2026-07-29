import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaiduAvatar } from './avatar'
import { BaiduLight } from './light'

const Baidu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaiduLight {...props} className={className} />
  return <BaiduLight {...props} className={className} />
}

export const BaiduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baidu, {
  Avatar: BaiduAvatar,
  colorPrimary: '#2932E1'
})

export default BaiduIcon
