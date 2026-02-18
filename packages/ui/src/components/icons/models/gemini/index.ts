import type { CompoundIcon } from '../../types'
import { GeminiAvatar } from './avatar'
import { Gemini } from './color'
import { GeminiMono } from './mono'

export const GeminiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemini, {
  Color: Gemini,
  Mono: GeminiMono,
  Avatar: GeminiAvatar,
  colorPrimary: '#1C7DFF'
})
export default GeminiIcon
