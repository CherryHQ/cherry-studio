import type { CompoundIcon } from '../../types'
import { Bfl } from './color'
import { BflMono } from './mono'

export const BflIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bfl, {
  Color: Bfl,
  Mono: BflMono,
  colorPrimary: '#000000'
})
export default BflIcon
