import type { CompoundIcon } from '../../types'
import { Moonshot } from './color'
import { MoonshotMono } from './mono'

export const MoonshotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Moonshot, {
  Color: Moonshot,
  Mono: MoonshotMono,
  colorPrimary: '#000000'
})
export default MoonshotIcon
