import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtimeTranslateAvatar } from './avatar'
import { GptRealtimeTranslateLight } from './light'

const GptRealtimeTranslate = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtimeTranslateLight {...props} className={className} />
  return <GptRealtimeTranslateLight {...props} className={className} />
}

export const GptRealtimeTranslateIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtimeTranslate, {
  Avatar: GptRealtimeTranslateAvatar,
  colorPrimary: '#000000'
})

export default GptRealtimeTranslateIcon
