import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GpustackAvatar } from './avatar'
import { GpustackLight } from './light'

const Gpustack = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GpustackLight {...props} className={className} />
  return <GpustackLight {...props} className={className} />
}

export const GpustackIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpustack, {
  Avatar: GpustackAvatar,
  colorPrimary: '#000000'
})

export default GpustackIcon
