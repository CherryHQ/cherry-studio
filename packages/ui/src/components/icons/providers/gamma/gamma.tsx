import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GammaAvatar } from './avatar'
import { GammaLight } from './light'

const Gamma = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GammaLight {...props} className={className} />
  return <GammaLight {...props} className={className} />
}

export const GammaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gamma, {
  Avatar: GammaAvatar,
  colorPrimary: '#000000'
})

export default GammaIcon
