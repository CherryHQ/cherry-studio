import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LingAvatar } from './avatar'
import { LingLight } from './light'

const Ling = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LingLight {...props} className={className} />
  return <LingLight {...props} className={className} />
}

export const LingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ling, {
  Avatar: LingAvatar,
  colorPrimary: '#0C73FF'
})

export default LingIcon
