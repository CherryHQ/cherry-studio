import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IntelAvatar } from './avatar'
import { IntelLight } from './light'

const Intel = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IntelLight {...props} className={className} />
  return <IntelLight {...props} className={className} />
}

export const IntelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Intel, {
  Avatar: IntelAvatar,
  colorPrimary: '#0071C5'
})

export default IntelIcon
