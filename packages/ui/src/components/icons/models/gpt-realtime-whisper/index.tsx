import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtimeWhisperAvatar } from './avatar'
import { GptRealtimeWhisperLight } from './light'

const GptRealtimeWhisper = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtimeWhisperLight {...props} className={className} />
  return <GptRealtimeWhisperLight {...props} className={className} />
}

export const GptRealtimeWhisperIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtimeWhisper, {
  Avatar: GptRealtimeWhisperAvatar,
  colorPrimary: '#000000'
})

export default GptRealtimeWhisperIcon
