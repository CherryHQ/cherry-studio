import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt45PreviewAvatar } from './avatar'
import { Gpt45PreviewLight } from './light'

const Gpt45Preview = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt45PreviewLight {...props} className={className} />
  return <Gpt45PreviewLight {...props} className={className} />
}

export const Gpt45PreviewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt45Preview, {
  Avatar: Gpt45PreviewAvatar,
  colorPrimary: '#000000'
})

export default Gpt45PreviewIcon
