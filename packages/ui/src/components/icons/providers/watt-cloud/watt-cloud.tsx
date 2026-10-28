import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WattCloudAvatar } from './avatar'
import { WattCloudLight } from './light'

const WattCloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WattCloudLight {...props} className={className} />
  return <WattCloudLight {...props} className={className} />
}

export const WattCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(WattCloud, {
  Avatar: WattCloudAvatar,
  colorPrimary: '#3F3F7A'
})

export default WattCloudIcon
