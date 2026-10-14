import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtime21MiniAvatar } from './avatar'
import { GptRealtime21MiniLight } from './light'

const GptRealtime21Mini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtime21MiniLight {...props} className={className} />
  return <GptRealtime21MiniLight {...props} className={className} />
}

export const GptRealtime21MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtime21Mini, {
  Avatar: GptRealtime21MiniAvatar,
  colorPrimary: '#000000'
})

export default GptRealtime21MiniIcon
