import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HigressAvatar } from './avatar'
import { HigressLight } from './light'

const Higress = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HigressLight {...props} className={className} />
  return <HigressLight {...props} className={className} />
}

export const HigressIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Higress, {
  Avatar: HigressAvatar,
  colorPrimary: '#000000'
})

export default HigressIcon
