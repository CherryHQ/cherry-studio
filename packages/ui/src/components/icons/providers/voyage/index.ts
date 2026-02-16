import type { CompoundIcon } from '../../types'
import { Voyage } from './color'
import { VoyageMono } from './mono'

export const VoyageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Voyage, {
  Color: Voyage,
  Mono: VoyageMono,
  colorPrimary: '#333333'
})
export default VoyageIcon
