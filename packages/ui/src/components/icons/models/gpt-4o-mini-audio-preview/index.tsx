import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oMiniAudioPreviewAvatar } from './avatar'
import { Gpt4oMiniAudioPreviewLight } from './light'

const Gpt4oMiniAudioPreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oMiniAudioPreviewLight {...props} className={className} />
  return <Gpt4oMiniAudioPreviewLight {...props} className={className} />
}

export const Gpt4oMiniAudioPreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oMiniAudioPreview, {
  Avatar: Gpt4oMiniAudioPreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oMiniAudioPreviewIcon
