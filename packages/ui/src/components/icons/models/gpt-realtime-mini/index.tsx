import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptRealtimeMiniAvatar } from './avatar'
import { GptRealtimeMiniLight } from './light'

const GptRealtimeMini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptRealtimeMiniLight {...props} className={className} />
  return <GptRealtimeMiniLight {...props} className={className} />
}

export const GptRealtimeMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptRealtimeMini, {
  Avatar: GptRealtimeMiniAvatar,
  colorPrimary: '#000000'
})

export default GptRealtimeMiniIcon
