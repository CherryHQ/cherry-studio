import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ThinkAnyAvatar } from './avatar'
import { ThinkAnyLight } from './light'

const ThinkAny = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ThinkAnyLight {...props} className={className} />
  return <ThinkAnyLight {...props} className={className} />
}

export const ThinkAnyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ThinkAny, {
  Avatar: ThinkAnyAvatar,
  colorPrimary: '#000000'
})

export default ThinkAnyIcon
