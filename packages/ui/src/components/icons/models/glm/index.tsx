import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GlmAvatar } from './avatar'
import { GlmLight } from './light'

const Glm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GlmLight {...props} className={className} />
  return <GlmLight {...props} className={className} />
}

export const GlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glm, {
  Avatar: GlmAvatar,
  colorPrimary: '#5072E9'
})

export default GlmIcon
