import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NvidiaAvatar } from './avatar'
import { NvidiaLight } from './light'

const Nvidia = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NvidiaLight {...props} className={className} />
  return <NvidiaLight {...props} className={className} />
}

export const NvidiaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nvidia, {
  Avatar: NvidiaAvatar,
  colorPrimary: '#76B900'
})

export default NvidiaIcon
