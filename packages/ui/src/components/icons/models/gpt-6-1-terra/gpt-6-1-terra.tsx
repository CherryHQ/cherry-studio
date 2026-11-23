import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt61TerraAvatar } from './avatar'
import { Gpt61TerraLight } from './light'

const Gpt61Terra = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt61TerraLight {...props} className={className} />

  return <Gpt61TerraLight {...props} className={className} />
}

export const Gpt61TerraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt61Terra, {
  Avatar: Gpt61TerraAvatar,
  colorPrimary: '#1C141A'
})

export default Gpt61TerraIcon
