import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptAudioMiniAvatar } from './avatar'
import { GptAudioMiniLight } from './light'

const GptAudioMini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptAudioMiniLight {...props} className={className} />
  return <GptAudioMiniLight {...props} className={className} />
}

export const GptAudioMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptAudioMini, {
  Avatar: GptAudioMiniAvatar,
  colorPrimary: '#000000'
})

export default GptAudioMiniIcon
