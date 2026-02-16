import type { CompoundIcon } from '../../types'
import { Cephalon } from './color'
import { CephalonMono } from './mono'

export const CephalonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cephalon, {
  Color: Cephalon,
  Mono: CephalonMono,
  colorPrimary: '#000000'
})
export default CephalonIcon
