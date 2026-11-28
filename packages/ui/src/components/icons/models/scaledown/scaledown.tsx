import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ScaledownAvatar } from './avatar'
import { ScaledownLight } from './light'

const Scaledown = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ScaledownLight {...props} className={className} />
  return <ScaledownLight {...props} className={className} />
}

export const ScaledownIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Scaledown, {
  Avatar: ScaledownAvatar,
  colorPrimary: '#000000'
})

export default ScaledownIcon
