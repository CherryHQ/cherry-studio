import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TiiAvatar } from './avatar'
import { TiiLight } from './light'

const Tii = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TiiLight {...props} className={className} />
  return <TiiLight {...props} className={className} />
}

export const TiiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tii, {
  Avatar: TiiAvatar,
  colorPrimary: '#6400FF'
})

export default TiiIcon
