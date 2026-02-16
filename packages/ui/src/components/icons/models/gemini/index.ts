import type { CompoundIcon } from '../../types'
import { Gemini } from './color'
import { GeminiMono } from './mono'

export const GeminiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemini, {
  Color: Gemini,
  Mono: GeminiMono,
  colorPrimary: '#1C7DFF'
})
export default GeminiIcon
