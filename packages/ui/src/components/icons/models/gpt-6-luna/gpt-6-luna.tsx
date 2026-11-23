import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt6LunaAvatar } from './avatar'
import { Gpt6LunaLight } from './light'

const Gpt6Luna = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt6LunaLight {...props} className={className} />

  return <Gpt6LunaLight {...props} className={className} />
}

export const Gpt6LunaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt6Luna, {
  Avatar: Gpt6LunaAvatar,
  colorPrimary: '#050404'
})

export default Gpt6LunaIcon
