import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AbacusAvatar } from './avatar'
import { AbacusLight } from './light'

const Abacus = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AbacusLight {...props} className={className} />
  return <AbacusLight {...props} className={className} />
}

export const AbacusIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Abacus, {
  Avatar: AbacusAvatar,
  colorPrimary: '#D7E5F0'
})

export default AbacusIcon
