import type { CompoundIcon } from '../../types'
import { TencentCloudTiAvatar } from './avatar'
import { TencentCloudTi } from './color'
import { TencentCloudTiMono } from './mono'

export const TencentCloudTiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TencentCloudTi, {
  Color: TencentCloudTi,
  Mono: TencentCloudTiMono,
  Avatar: TencentCloudTiAvatar,
  colorPrimary: '#00A3FF'
})
export default TencentCloudTiIcon
