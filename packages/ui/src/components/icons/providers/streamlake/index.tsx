import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StreamlakeAvatar } from './avatar'
import { StreamlakeLight } from './light'

const Streamlake = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StreamlakeLight {...props} className={className} />
  return <StreamlakeLight {...props} className={className} />
}

export const StreamlakeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Streamlake, {
  Avatar: StreamlakeAvatar,
  colorPrimary: '#1D70FF'
})

export default StreamlakeIcon
