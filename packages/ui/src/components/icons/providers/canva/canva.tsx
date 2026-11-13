import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CanvaAvatar } from './avatar'
import { CanvaLight } from './light'

const Canva = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CanvaLight {...props} className={className} />
  return <CanvaLight {...props} className={className} />
}

export const CanvaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Canva, {
  Avatar: CanvaAvatar,
  colorPrimary: '#000000'
})

export default CanvaIcon
