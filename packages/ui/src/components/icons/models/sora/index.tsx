import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SoraAvatar } from './avatar'
import { SoraLight } from './light'

const Sora = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SoraLight {...props} className={className} />
  return <SoraLight {...props} className={className} />
}

export const SoraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sora, {
  Avatar: SoraAvatar,
  colorPrimary: '#000000'
})

export default SoraIcon
