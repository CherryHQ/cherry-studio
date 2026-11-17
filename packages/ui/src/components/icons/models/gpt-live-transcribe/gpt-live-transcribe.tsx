import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptLiveTranscribeAvatar } from './avatar'
import { GptLiveTranscribeLight } from './light'

const GptLiveTranscribe = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptLiveTranscribeLight {...props} className={className} />
  return <GptLiveTranscribeLight {...props} className={className} />
}

export const GptLiveTranscribeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptLiveTranscribe, {
  Avatar: GptLiveTranscribeAvatar,
  colorPrimary: '#192558'
})

export default GptLiveTranscribeIcon
