import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtimeAvatar } from './avatar'
import { GptRealtimeLight } from './light'

const GptRealtime = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtimeLight {...props} className={className} />
  return <GptRealtimeLight {...props} className={className} />
}

export const GptRealtimeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtime, {
  Avatar: GptRealtimeAvatar,
  colorPrimary: '#000000'
})

export default GptRealtimeIcon
