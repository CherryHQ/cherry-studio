import { type CompoundIcon } from '../../types'
import { XirangAvatar } from './avatar'
import { Xirang } from './color'
import { XirangMono } from './mono'

export const XirangIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xirang, {
  Color: Xirang,
  Mono: XirangMono,
  Avatar: XirangAvatar,
  colorPrimary: '#DF0428'
})

export default XirangIcon
