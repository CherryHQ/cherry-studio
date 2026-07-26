import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KolorsAvatar } from './avatar'
import { KolorsLight } from './light'

const Kolors = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KolorsLight {...props} className={className} />
  return <KolorsLight {...props} className={className} />
}

export const KolorsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kolors, {
  Avatar: KolorsAvatar,
  colorPrimary: '#000000'
})

export default KolorsIcon
