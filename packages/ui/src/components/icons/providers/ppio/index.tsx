import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PpioAvatar } from './avatar'
import { PpioLight } from './light'

const Ppio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PpioLight {...props} className={className} />
  return <PpioLight {...props} className={className} />
}

export const PpioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ppio, {
  Avatar: PpioAvatar,
  colorPrimary: '#0062E2'
})

export default PpioIcon
