import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QiniuAvatar } from './avatar'
import { QiniuLight } from './light'

const Qiniu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QiniuLight {...props} className={className} />
  return <QiniuLight {...props} className={className} />
}

export const QiniuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qiniu, {
  Avatar: QiniuAvatar,
  colorPrimary: '#06AEEF'
})

export default QiniuIcon
