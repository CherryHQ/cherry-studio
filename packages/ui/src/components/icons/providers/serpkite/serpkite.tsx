import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SerpKiteAvatar } from './avatar'
import { SerpKiteLight } from './light'

const SerpKite = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SerpKiteLight {...props} className={className} />
  return <SerpKiteLight {...props} className={className} />
}

export const SerpKiteIcon: CompoundIcon = /*#__PURE__*/ Object.assign(SerpKite, {
  Avatar: SerpKiteAvatar,
  colorPrimary: '#F0642E'
})

export default SerpKiteIcon
