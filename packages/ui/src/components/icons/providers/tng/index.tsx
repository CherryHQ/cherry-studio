import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TngAvatar } from './avatar'
import { TngLight } from './light'

const Tng = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TngLight {...props} className={className} />
  return <TngLight {...props} className={className} />
}

export const TngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tng, {
  Avatar: TngAvatar,
  colorPrimary: '#FDFEFE'
})

export default TngIcon
