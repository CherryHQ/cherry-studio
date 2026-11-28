import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ReflectionAvatar } from './avatar'
import { ReflectionLight } from './light'

const Reflection = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ReflectionLight {...props} className={className} />
  return <ReflectionLight {...props} className={className} />
}

export const ReflectionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Reflection, {
  Avatar: ReflectionAvatar,
  colorPrimary: '#FBF4EC'
})

export default ReflectionIcon
