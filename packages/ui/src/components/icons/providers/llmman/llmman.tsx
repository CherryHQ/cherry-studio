import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LlmmanAvatar } from './avatar'
import { LlmmanLight } from './light'

const Llmman = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LlmmanLight {...props} className={className} />
  return <LlmmanLight {...props} className={className} />
}

export const LlmmanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Llmman, {
  Avatar: LlmmanAvatar,
  colorPrimary: '#000000'
})

export default LlmmanIcon
