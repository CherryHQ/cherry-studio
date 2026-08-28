import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YouAvatar } from './avatar'
import { YouLight } from './light'

const You = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YouLight {...props} className={className} />
  return <YouLight {...props} className={className} />
}

export const YouIcon: CompoundIcon = /*#__PURE__*/ Object.assign(You, {
  Avatar: YouAvatar,
  colorPrimary: '#000000'
})

export default YouIcon
