import type { CompoundIcon } from '../../types'
import { GemmaAvatar } from './avatar'
import { Gemma } from './color'
import { GemmaMono } from './mono'

export const GemmaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemma, {
  Color: Gemma,
  Mono: GemmaMono,
  Avatar: GemmaAvatar,
  colorPrimary: '#53A3FF'
})
export default GemmaIcon
