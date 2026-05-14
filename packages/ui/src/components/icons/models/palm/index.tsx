import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PalmAvatar } from './avatar'
import { PalmLight } from './light'

const Palm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PalmLight {...props} className={className} />
  return <PalmLight {...props} className={className} />
}

export const PalmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Palm, {
  Avatar: PalmAvatar,
  colorPrimary: '#FEFEFE'
})

export default PalmIcon
