import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GensparkAvatar } from './avatar'
import { GensparkLight } from './light'

const Genspark = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GensparkLight {...props} className={className} />
  return <GensparkLight {...props} className={className} />
}

export const GensparkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Genspark, {
  Avatar: GensparkAvatar,
  colorPrimary: '#000000'
})

export default GensparkIcon
