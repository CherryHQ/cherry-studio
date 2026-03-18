import { type CompoundIcon } from '../../types'
import { XinghuoAvatar } from './avatar'
import { Xinghuo } from './color'
import { XinghuoMono } from './mono'

export const XinghuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xinghuo, {
  Color: Xinghuo,
  Mono: XinghuoMono,
  Avatar: XinghuoAvatar,
  colorPrimary: '#18BDFE'
})

export default XinghuoIcon
