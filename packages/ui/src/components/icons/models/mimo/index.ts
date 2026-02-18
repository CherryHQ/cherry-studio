import type { CompoundIcon } from '../../types'
import { MimoAvatar } from './avatar'
import { Mimo } from './color'
import { MimoMono } from './mono'

export const MimoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mimo, {
  Color: Mimo,
  Mono: MimoMono,
  Avatar: MimoAvatar,
  colorPrimary: '#000000'
})
export default MimoIcon
