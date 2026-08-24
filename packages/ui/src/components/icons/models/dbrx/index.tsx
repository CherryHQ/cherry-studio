import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DbrxAvatar } from './avatar'
import { DbrxLight } from './light'

const Dbrx = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DbrxLight {...props} className={className} />
  return <DbrxLight {...props} className={className} />
}

export const DbrxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dbrx, {
  Avatar: DbrxAvatar,
  colorPrimary: '#EE3D2C'
})

export default DbrxIcon
