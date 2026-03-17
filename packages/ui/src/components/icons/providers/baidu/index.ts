import { type CompoundIcon } from '../../types'
import { BaiduAvatar } from './avatar'
import { Baidu } from './color'
import { BaiduMono } from './mono'

export const BaiduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baidu, {
  Color: Baidu,
  Mono: BaiduMono,
  Avatar: BaiduAvatar,
  colorPrimary: '#2932E1'
})

export default BaiduIcon
