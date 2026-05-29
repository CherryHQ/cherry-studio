import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MistralAvatar } from './avatar'
import { MistralLight } from './light'

const Mistral = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MistralLight {...props} className={className} />
  return <MistralLight {...props} className={className} />
}

export const MistralIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mistral, {
  Avatar: MistralAvatar,
  colorPrimary: '#FA500F'
})

export default MistralIcon
