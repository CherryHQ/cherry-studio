import { type CompoundIcon } from '../../types'
import { ZeroOneAvatar } from './avatar'
import { ZeroOne } from './color'
import { ZeroOneMono } from './mono'

export const ZeroOneIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZeroOne, {
  Color: ZeroOne,
  Mono: ZeroOneMono,
  Avatar: ZeroOneAvatar,
  colorPrimary: '#133426'
})

export default ZeroOneIcon
