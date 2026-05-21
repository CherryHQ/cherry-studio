import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SiliconAvatar } from './avatar'
import { SiliconLight } from './light'

const Silicon = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SiliconLight {...props} className={className} />
  return <SiliconLight {...props} className={className} />
}

export const SiliconIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Silicon, {
  Avatar: SiliconAvatar,
  colorPrimary: '#6E29F6'
})

export default SiliconIcon
