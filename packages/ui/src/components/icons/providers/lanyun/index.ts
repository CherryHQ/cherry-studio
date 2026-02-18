import type { CompoundIcon } from '../../types'
import { LanyunAvatar } from './avatar'
import { Lanyun } from './color'
import { LanyunMono } from './mono'

export const LanyunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lanyun, {
  Color: Lanyun,
  Mono: LanyunMono,
  Avatar: LanyunAvatar,
  colorPrimary: '#000000'
})
export default LanyunIcon
