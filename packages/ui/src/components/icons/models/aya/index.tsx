import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AyaAvatar } from './avatar'
import { AyaLight } from './light'

const Aya = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AyaLight {...props} className={className} />
  return <AyaLight {...props} className={className} />
}

export const AyaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aya, {
  Avatar: AyaAvatar,
  colorPrimary: '#010201'
})

export default AyaIcon
