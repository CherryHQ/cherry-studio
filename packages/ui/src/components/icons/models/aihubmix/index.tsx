import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AihubmixAvatar } from './avatar'
import { AihubmixLight } from './light'

const Aihubmix = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AihubmixLight {...props} className={className} />
  return <AihubmixLight {...props} className={className} />
}

export const AihubmixIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aihubmix, {
  Avatar: AihubmixAvatar,
  colorPrimary: '#006FFB'
})

export default AihubmixIcon
