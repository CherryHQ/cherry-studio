import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InternlmAvatar } from './avatar'
import { InternlmLight } from './light'

const Internlm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InternlmLight {...props} className={className} />
  return <InternlmLight {...props} className={className} />
}

export const InternlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Internlm, {
  Avatar: InternlmAvatar,
  colorPrimary: '#858599'
})

export default InternlmIcon
