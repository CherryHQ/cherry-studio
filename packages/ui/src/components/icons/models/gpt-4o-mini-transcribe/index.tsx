import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oMiniTranscribeAvatar } from './avatar'
import { Gpt4oMiniTranscribeLight } from './light'

const Gpt4oMiniTranscribe = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oMiniTranscribeLight {...props} className={className} />
  return <Gpt4oMiniTranscribeLight {...props} className={className} />
}

export const Gpt4oMiniTranscribeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oMiniTranscribe, {
  Avatar: Gpt4oMiniTranscribeAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oMiniTranscribeIcon
