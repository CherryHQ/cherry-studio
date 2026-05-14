import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AllenaiAvatar } from './avatar'
import { AllenaiLight } from './light'

const Allenai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AllenaiLight {...props} className={className} />
  return <AllenaiLight {...props} className={className} />
}

export const AllenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Allenai, {
  Avatar: AllenaiAvatar,
  colorPrimary: '#F8F0E9'
})

export default AllenaiIcon
