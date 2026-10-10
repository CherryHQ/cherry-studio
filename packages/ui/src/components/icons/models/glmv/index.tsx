import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GlmvAvatar } from './avatar'
import { GlmvLight } from './light'

const Glmv = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GlmvLight {...props} className={className} />
  return <GlmvLight {...props} className={className} />
}

export const GlmvIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glmv, {
  Avatar: GlmvAvatar,
  colorPrimary: '#0039C6'
})

export default GlmvIcon
