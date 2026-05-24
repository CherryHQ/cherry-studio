import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HuggingfaceAvatar } from './avatar'
import { HuggingfaceLight } from './light'

const Huggingface = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HuggingfaceLight {...props} className={className} />
  return <HuggingfaceLight {...props} className={className} />
}

export const HuggingfaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Huggingface, {
  Avatar: HuggingfaceAvatar,
  colorPrimary: '#FF9D0B'
})

export default HuggingfaceIcon
