import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4TurboPreviewAvatar } from './avatar'
import { Gpt4TurboPreviewLight } from './light'

const Gpt4TurboPreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4TurboPreviewLight {...props} className={className} />
  return <Gpt4TurboPreviewLight {...props} className={className} />
}

export const Gpt4TurboPreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4TurboPreview, {
  Avatar: Gpt4TurboPreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4TurboPreviewIcon
