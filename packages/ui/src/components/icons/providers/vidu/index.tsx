import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ViduAvatar } from './avatar'
import { ViduLight } from './light'

const Vidu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ViduLight {...props} className={className} />
  return <ViduLight {...props} className={className} />
}

export const ViduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vidu, {
  Avatar: ViduAvatar,
  colorPrimary: '#000000'
})

export default ViduIcon
