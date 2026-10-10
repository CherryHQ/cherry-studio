import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oAudioPreviewAvatar } from './avatar'
import { Gpt4oAudioPreviewLight } from './light'

const Gpt4oAudioPreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oAudioPreviewLight {...props} className={className} />
  return <Gpt4oAudioPreviewLight {...props} className={className} />
}

export const Gpt4oAudioPreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oAudioPreview, {
  Avatar: Gpt4oAudioPreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oAudioPreviewIcon
