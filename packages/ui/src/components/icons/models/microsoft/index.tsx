import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MicrosoftAvatar } from './avatar'
import { MicrosoftLight } from './light'

const Microsoft = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MicrosoftLight {...props} className={className} />
  return <MicrosoftLight {...props} className={className} />
}

export const MicrosoftIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Microsoft, {
  Avatar: MicrosoftAvatar,
  colorPrimary: '#F25022'
})

export default MicrosoftIcon
