import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VolcengineAvatar } from './avatar'
import { VolcengineLight } from './light'

const Volcengine = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VolcengineLight {...props} className={className} />
  return <VolcengineLight {...props} className={className} />
}

export const VolcengineIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Volcengine, {
  Avatar: VolcengineAvatar,
  colorPrimary: '#00E5E5'
})

export default VolcengineIcon
