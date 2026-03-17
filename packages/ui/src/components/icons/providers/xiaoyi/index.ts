import { type CompoundIcon } from '../../types'
import { XiaoyiAvatar } from './avatar'
import { Xiaoyi } from './color'
import { XiaoyiMono } from './mono'

export const XiaoyiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xiaoyi, {
  Color: Xiaoyi,
  Mono: XiaoyiMono,
  Avatar: XiaoyiAvatar,
  colorPrimary: '#ED93FE'
})

export default XiaoyiIcon
