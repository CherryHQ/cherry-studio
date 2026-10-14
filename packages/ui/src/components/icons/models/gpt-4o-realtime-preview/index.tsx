import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oRealtimePreviewAvatar } from './avatar'
import { Gpt4oRealtimePreviewLight } from './light'

const Gpt4oRealtimePreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oRealtimePreviewLight {...props} className={className} />
  return <Gpt4oRealtimePreviewLight {...props} className={className} />
}

export const Gpt4oRealtimePreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oRealtimePreview, {
  Avatar: Gpt4oRealtimePreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oRealtimePreviewIcon
