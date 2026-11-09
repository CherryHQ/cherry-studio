import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LovableAvatar } from './avatar'
import { LovableLight } from './light'

const Lovable = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LovableLight {...props} className={className} />
  return <LovableLight {...props} className={className} />
}

export const LovableIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lovable, {
  Avatar: LovableAvatar,
  colorPrimary: '#000000'
})

export default LovableIcon
