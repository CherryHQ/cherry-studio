import type { CompoundIcon, CompoundIconProps } from '../../types'
import { WallyAvatar } from './avatar'
import { WallyLight } from './light'

const Wally = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <WallyLight {...props} className={className} />
  return <WallyLight {...props} className={className} />
}

export const WallyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Wally, {
  Avatar: WallyAvatar,
  colorPrimary: '#FF6900'
})

export default WallyIcon
