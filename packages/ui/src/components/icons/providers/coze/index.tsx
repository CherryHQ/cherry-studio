import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CozeAvatar } from './avatar'
import { CozeLight } from './light'

const Coze = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CozeLight {...props} className={className} />
  return <CozeLight {...props} className={className} />
}

export const CozeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Coze, {
  Avatar: CozeAvatar,
  colorPrimary: '#4D53E8'
})

export default CozeIcon
