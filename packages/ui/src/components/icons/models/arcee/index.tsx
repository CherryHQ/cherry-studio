import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ArceeAvatar } from './avatar'
import { ArceeLight } from './light'

const Arcee = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ArceeLight {...props} className={className} />
  return <ArceeLight {...props} className={className} />
}

export const ArceeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Arcee, {
  Avatar: ArceeAvatar,
  colorPrimary: '#008C8C'
})

export default ArceeIcon
