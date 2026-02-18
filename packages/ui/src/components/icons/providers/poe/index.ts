import type { CompoundIcon } from '../../types'
import { PoeAvatar } from './avatar'
import { Poe } from './color'
import { PoeMono } from './mono'

export const PoeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Poe, {
  Color: Poe,
  Mono: PoeMono,
  Avatar: PoeAvatar,
  colorPrimary: '#000000'
})
export default PoeIcon
