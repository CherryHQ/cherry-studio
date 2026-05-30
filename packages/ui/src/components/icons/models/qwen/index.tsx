import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QwenAvatar } from './avatar'
import { QwenLight } from './light'

const Qwen = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QwenLight {...props} className={className} />
  return <QwenLight {...props} className={className} />
}

export const QwenIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qwen, {
  Avatar: QwenAvatar,
  colorPrimary: '#615CED'
})

export default QwenIcon
