import type { CompoundIcon } from '../../types'
import { KwaipilotAvatar } from './avatar'
import { Kwaipilot } from './color'
import { KwaipilotMono } from './mono'

export const KwaipilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kwaipilot, {
  Color: Kwaipilot,
  Mono: KwaipilotMono,
  Avatar: KwaipilotAvatar,
  colorPrimary: '#000000'
})
export default KwaipilotIcon
