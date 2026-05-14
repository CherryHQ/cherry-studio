import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AiOnlyAvatar } from './avatar'
import { AiOnlyLight } from './light'

const AiOnly = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AiOnlyLight {...props} className={className} />
  return <AiOnlyLight {...props} className={className} />
}

export const AiOnlyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiOnly, {
  Avatar: AiOnlyAvatar,
  colorPrimary: '#00E5E5'
})

export default AiOnlyIcon
