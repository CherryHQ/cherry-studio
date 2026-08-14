import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oSearchPreviewAvatar } from './avatar'
import { Gpt4oSearchPreviewLight } from './light'

const Gpt4oSearchPreview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oSearchPreviewLight {...props} className={className} />
  return <Gpt4oSearchPreviewLight {...props} className={className} />
}

export const Gpt4oSearchPreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4oSearchPreview, {
  Avatar: Gpt4oSearchPreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oSearchPreviewIcon
