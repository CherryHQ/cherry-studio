import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DothooshAvatar } from './avatar'
import { DothooshLight } from './light'

const Dothoosh = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DothooshLight {...props} className={className} />
  return <DothooshLight {...props} className={className} />
}

export const DothooshIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dothoosh, {
  Avatar: DothooshAvatar,
  colorPrimary: '#000'
})

export default DothooshIcon
