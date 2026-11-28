import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaiducloudAvatar } from './avatar'
import { BaiducloudLight } from './light'

const Baiducloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaiducloudLight {...props} className={className} />
  return <BaiducloudLight {...props} className={className} />
}

export const BaiducloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baiducloud, {
  Avatar: BaiducloudAvatar,
  colorPrimary: '#f0faf4'
})

export default BaiducloudIcon
