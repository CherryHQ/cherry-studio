import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BytedanceAvatar } from './avatar'
import { BytedanceLight } from './light'

const Bytedance = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BytedanceLight {...props} className={className} />
  return <BytedanceLight {...props} className={className} />
}

export const BytedanceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bytedance, {
  Avatar: BytedanceAvatar,
  colorPrimary: '#00C8D2'
})

export default BytedanceIcon
