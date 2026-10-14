import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RadeonCloudAvatar } from './avatar'
import { RadeonCloudLight } from './light'

const RadeonCloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RadeonCloudLight {...props} className={className} />
  return <RadeonCloudLight {...props} className={className} />
}

export const RadeonCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(RadeonCloud, {
  Avatar: RadeonCloudAvatar,
  colorPrimary: '#000000'
})

export default RadeonCloudIcon
