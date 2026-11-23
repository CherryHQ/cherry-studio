import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptTranscribeAvatar } from './avatar'
import { GptTranscribeLight } from './light'

const GptTranscribe = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptTranscribeLight {...props} className={className} />

  return <GptTranscribeLight {...props} className={className} />
}

export const GptTranscribeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptTranscribe, {
  Avatar: GptTranscribeAvatar,
  colorPrimary: '#6E62C2'
})

export default GptTranscribeIcon
