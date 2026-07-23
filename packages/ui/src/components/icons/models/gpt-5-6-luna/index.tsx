import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt56LunaAvatar } from './avatar'
import { Gpt56LunaLight } from './light'

const Gpt56Luna = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt56LunaLight {...props} className={className} />
  return <Gpt56LunaLight {...props} className={className} />
}

export const Gpt56LunaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt56Luna, {
  Avatar: Gpt56LunaAvatar,
  colorPrimary: '#000000'
})

export default Gpt56LunaIcon
