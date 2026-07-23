import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oMiniSearchPreviewAvatar } from './avatar'
import { Gpt4oMiniSearchPreviewLight } from './light'

const Gpt4oMiniSearchPreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oMiniSearchPreviewLight {...props} className={className} />
  return <Gpt4oMiniSearchPreviewLight {...props} className={className} />
}

export const Gpt4oMiniSearchPreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oMiniSearchPreview, {
  Avatar: Gpt4oMiniSearchPreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oMiniSearchPreviewIcon
