import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MorphAvatar } from './avatar'
import { MorphLight } from './light'

const Morph = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MorphLight {...props} className={className} />

  return <MorphLight {...props} className={className} />
}

export const MorphIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Morph, {
  Avatar: MorphAvatar,
  colorPrimary: '#f6fbec'
})

export default MorphIcon
