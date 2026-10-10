import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oTranscribeAvatar } from './avatar'
import { Gpt4oTranscribeLight } from './light'

const Gpt4oTranscribe = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oTranscribeLight {...props} className={className} />
  return <Gpt4oTranscribeLight {...props} className={className} />
}

export const Gpt4oTranscribeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oTranscribe, {
  Avatar: Gpt4oTranscribeAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oTranscribeIcon
