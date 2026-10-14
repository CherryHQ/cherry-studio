import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DeepseekAvatar } from './avatar'
import { DeepseekLight } from './light'

const Deepseek = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DeepseekLight {...props} className={className} />
  return <DeepseekLight {...props} className={className} />
}

export const DeepseekIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Deepseek, {
  Avatar: DeepseekAvatar,
  colorPrimary: '#4D6BFE'
})

export default DeepseekIcon
