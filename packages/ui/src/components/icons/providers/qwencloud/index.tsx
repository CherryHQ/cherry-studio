import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QwencloudAvatar } from './avatar'
import { QwencloudLight } from './light'

const Qwencloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QwencloudLight {...props} className={className} />
  return <QwencloudLight {...props} className={className} />
}

export const QwencloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qwencloud, {
  Avatar: QwencloudAvatar,
  colorPrimary: '#4F21FF'
})

export default QwencloudIcon
