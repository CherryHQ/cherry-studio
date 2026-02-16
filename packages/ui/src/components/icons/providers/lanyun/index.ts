import type { CompoundIcon } from '../../types'
import { Lanyun } from './color'
import { LanyunMono } from './mono'

export const LanyunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lanyun, {
  Color: Lanyun,
  Mono: LanyunMono,
  colorPrimary: '#000000'
})
export default LanyunIcon
