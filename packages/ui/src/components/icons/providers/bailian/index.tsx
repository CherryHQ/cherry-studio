import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BailianAvatar } from './avatar'
import { BailianLight } from './light'

const Bailian = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BailianLight {...props} className={className} />
  return <BailianLight {...props} className={className} />
}

export const BailianIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bailian, {
  Avatar: BailianAvatar,
  colorPrimary: '#00EAD1'
})

export default BailianIcon
