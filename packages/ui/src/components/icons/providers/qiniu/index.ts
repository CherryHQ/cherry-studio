import { type CompoundIcon } from '../../types'
import { QiniuAvatar } from './avatar'
import { Qiniu } from './color'
import { QiniuMono } from './mono'

export const QiniuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qiniu, {
  Color: Qiniu,
  Mono: QiniuMono,
  Avatar: QiniuAvatar,
  colorPrimary: '#06AEEF'
})

export default QiniuIcon
