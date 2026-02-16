import type { CompoundIcon } from '../../types'
import { Glm } from './color'
import { GlmMono } from './mono'

export const GlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glm, {
  Color: Glm,
  Mono: GlmMono,
  colorPrimary: '#5072E9'
})
export default GlmIcon
