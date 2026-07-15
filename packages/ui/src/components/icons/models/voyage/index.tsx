import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VoyageAvatar } from './avatar'
import { VoyageLight } from './light'

const Voyage = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VoyageLight {...props} className={className} />
  return <VoyageLight {...props} className={className} />
}

export const VoyageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Voyage, {
  Avatar: VoyageAvatar,
  colorPrimary: '#012E33'
})

export default VoyageIcon
