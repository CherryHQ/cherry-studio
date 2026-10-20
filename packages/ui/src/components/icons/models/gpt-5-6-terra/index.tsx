import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt56TerraAvatar } from './avatar'
import { Gpt56TerraLight } from './light'

const Gpt56Terra = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt56TerraLight {...props} className={className} />
  return <Gpt56TerraLight {...props} className={className} />
}

export const Gpt56TerraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt56Terra, {
  Avatar: Gpt56TerraAvatar,
  colorPrimary: '#000000'
})

export default Gpt56TerraIcon
