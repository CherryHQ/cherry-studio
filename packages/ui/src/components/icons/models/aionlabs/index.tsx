import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AionlabsAvatar } from './avatar'
import { AionlabsLight } from './light'

const Aionlabs = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AionlabsLight {...props} className={className} />
  return <AionlabsLight {...props} className={className} />
}

export const AionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aionlabs, {
  Avatar: AionlabsAvatar,
  colorPrimary: '#C2D1D3'
})

export default AionlabsIcon
