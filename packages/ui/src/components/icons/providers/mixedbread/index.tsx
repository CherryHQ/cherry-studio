import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MixedbreadAvatar } from './avatar'
import { MixedbreadLight } from './light'

const Mixedbread = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MixedbreadLight {...props} className={className} />
  return <MixedbreadLight {...props} className={className} />
}

export const MixedbreadIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mixedbread, {
  Avatar: MixedbreadAvatar,
  colorPrimary: '#EC6168'
})

export default MixedbreadIcon
