import type { CompoundIcon } from '../../types'
import { MoonshotAvatar } from './avatar'
import { Moonshot } from './color'
import { MoonshotMono } from './mono'

export const MoonshotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Moonshot, {
  Color: Moonshot,
  Mono: MoonshotMono,
  Avatar: MoonshotAvatar,
  colorPrimary: '#000000'
})
export default MoonshotIcon
