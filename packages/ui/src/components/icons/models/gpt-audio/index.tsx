import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptAudioAvatar } from './avatar'
import { GptAudioLight } from './light'

const GptAudio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptAudioLight {...props} className={className} />
  return <GptAudioLight {...props} className={className} />
}

export const GptAudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptAudio, {
  Avatar: GptAudioAvatar,
  colorPrimary: '#000000'
})

export default GptAudioIcon
