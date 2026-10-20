import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TogetherAvatar } from './avatar'
import { TogetherLight } from './light'

const Together = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TogetherLight {...props} className={className} />
  return <TogetherLight {...props} className={className} />
}

export const TogetherIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Together, {
  Avatar: TogetherAvatar,
  colorPrimary: '#EF2CC1'
})

export default TogetherIcon
