import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oMiniRealtimePreviewAvatar } from './avatar'
import { Gpt4oMiniRealtimePreviewLight } from './light'

const Gpt4oMiniRealtimePreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oMiniRealtimePreviewLight {...props} className={className} />
  return <Gpt4oMiniRealtimePreviewLight {...props} className={className} />
}

export const Gpt4oMiniRealtimePreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oMiniRealtimePreview, {
  Avatar: Gpt4oMiniRealtimePreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oMiniRealtimePreviewIcon
