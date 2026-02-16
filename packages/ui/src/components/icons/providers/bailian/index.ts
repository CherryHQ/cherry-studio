import type { CompoundIcon } from '../../types'
import { Bailian } from './color'
import { BailianMono } from './mono'

export const BailianIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bailian, {
  Color: Bailian,
  Mono: BailianMono,
  colorPrimary: '#00EAD1'
})
export default BailianIcon
