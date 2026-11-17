import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptDaybreakBlueLatestAvatar } from './avatar'
import { GptDaybreakBlueLatestLight } from './light'

const GptDaybreakBlueLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptDaybreakBlueLatestLight {...props} className={className} />
  return <GptDaybreakBlueLatestLight {...props} className={className} />
}

export const GptDaybreakBlueLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptDaybreakBlueLatest, {
  Avatar: GptDaybreakBlueLatestAvatar,
  colorPrimary: '#050403'
})

export default GptDaybreakBlueLatestIcon
