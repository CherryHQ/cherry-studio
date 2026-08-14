import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TencentCloudTiAvatar } from './avatar'
import { TencentCloudTiLight } from './light'

const TencentCloudTi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TencentCloudTiLight {...props} className={className} />
  return <TencentCloudTiLight {...props} className={className} />
}

export const TencentCloudTiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TencentCloudTi, {
  Avatar: TencentCloudTiAvatar,
  colorPrimary: '#00A3FF'
})

export default TencentCloudTiIcon
