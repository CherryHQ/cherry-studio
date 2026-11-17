import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaiduCloudAvatar } from './avatar'
import { BaiduCloudLight } from './light'

const BaiduCloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaiduCloudLight {...props} className={className} />
  return <BaiduCloudLight {...props} className={className} />
}

export const BaiduCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BaiduCloud, {
  Avatar: BaiduCloudAvatar,
  colorPrimary: '#f0faf4'
})

export default BaiduCloudIcon
