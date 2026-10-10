import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HailuoAvatar } from './avatar'
import { HailuoLight } from './light'

const Hailuo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HailuoLight {...props} className={className} />
  return <HailuoLight {...props} className={className} />
}

export const HailuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hailuo, {
  Avatar: HailuoAvatar,
  colorPrimary: '#000000'
})

export default HailuoIcon
