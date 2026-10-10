import type { CompoundIcon, CompoundIconProps } from '../../types'
import { UpstageAvatar } from './avatar'
import { UpstageLight } from './light'

const Upstage = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <UpstageLight {...props} className={className} />
  return <UpstageLight {...props} className={className} />
}

export const UpstageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Upstage, {
  Avatar: UpstageAvatar,
  colorPrimary: '#8867FB'
})

export default UpstageIcon
