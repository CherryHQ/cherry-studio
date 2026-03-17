import { type CompoundIcon } from '../../types'
import { BaiduCloudAvatar } from './avatar'
import { BaiduCloud } from './color'
import { BaiduCloudMono } from './mono'

export const BaiduCloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BaiduCloud, {
  Color: BaiduCloud,
  Mono: BaiduCloudMono,
  Avatar: BaiduCloudAvatar,
  colorPrimary: '#5BCA87'
})

export default BaiduCloudIcon
