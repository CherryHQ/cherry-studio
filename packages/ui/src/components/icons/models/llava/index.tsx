import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LlavaAvatar } from './avatar'
import { LlavaLight } from './light'

const Llava = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LlavaLight {...props} className={className} />
  return <LlavaLight {...props} className={className} />
}

export const LlavaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Llava, {
  Avatar: LlavaAvatar,
  colorPrimary: '#717578'
})

export default LlavaIcon
