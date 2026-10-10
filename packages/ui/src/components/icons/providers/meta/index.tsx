import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MetaAvatar } from './avatar'
import { MetaLight } from './light'

const Meta = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MetaLight {...props} className={className} />
  return <MetaLight {...props} className={className} />
}

export const MetaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Meta, {
  Avatar: MetaAvatar,
  colorPrimary: '#0081FB'
})

export default MetaIcon
