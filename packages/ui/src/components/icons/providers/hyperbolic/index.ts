import type { CompoundIcon } from '../../types'
import { Hyperbolic } from './color'
import { HyperbolicMono } from './mono'

export const HyperbolicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hyperbolic, {
  Color: Hyperbolic,
  Mono: HyperbolicMono,
  colorPrimary: '#594CE9'
})
export default HyperbolicIcon
