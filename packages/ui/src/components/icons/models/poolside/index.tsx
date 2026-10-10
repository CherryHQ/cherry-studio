import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PoolsideAvatar } from './avatar'
import { PoolsideLight } from './light'

const Poolside = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PoolsideLight {...props} className={className} />
  return <PoolsideLight {...props} className={className} />
}

export const PoolsideIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Poolside, {
  Avatar: PoolsideAvatar,
  colorPrimary: '#4137FF'
})

export default PoolsideIcon
