import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RwkvAvatar } from './avatar'
import { RwkvLight } from './light'

const Rwkv = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RwkvLight {...props} className={className} />
  return <RwkvLight {...props} className={className} />
}

export const RwkvIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Rwkv, {
  Avatar: RwkvAvatar,
  colorPrimary: '#000000'
})

export default RwkvIcon
