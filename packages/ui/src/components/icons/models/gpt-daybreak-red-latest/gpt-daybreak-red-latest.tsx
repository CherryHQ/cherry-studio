import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GptDaybreakRedLatestAvatar } from './avatar'
import { GptDaybreakRedLatestLight } from './light'

const GptDaybreakRedLatest = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GptDaybreakRedLatestLight {...props} className={className} />

  return <GptDaybreakRedLatestLight {...props} className={className} />
}

export const GptDaybreakRedLatestIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptDaybreakRedLatest, {
  Avatar: GptDaybreakRedLatestAvatar,
  colorPrimary: '#000100'
})

export default GptDaybreakRedLatestIcon
