import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AvalaiAvatar } from './avatar'
import { AvalaiLight } from './light'

const Avalai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AvalaiLight {...props} className={className} />
  return <AvalaiLight {...props} className={className} />
}

export const AvalaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Avalai, {
  Avatar: AvalaiAvatar,
  colorPrimary: '#0E9384'
})

export default AvalaiIcon
