import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SerplyAvatar } from './avatar'
import { SerplyLight } from './light'

const Serply = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SerplyLight {...props} className={className} />
  return <SerplyLight {...props} className={className} />
}

export const SerplyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Serply, {
  Avatar: SerplyAvatar,
  colorPrimary: '#F03E2F'
})

export default SerplyIcon
