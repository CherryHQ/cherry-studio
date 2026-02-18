import { type CompoundIcon } from '../../types'
import { GlmAvatar } from './avatar'
import { Glm } from './color'
import { GlmMono } from './mono'

export const GlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glm, {
  Color: Glm,
  Mono: GlmMono,
  Avatar: GlmAvatar,
  colorPrimary: '#5072E9'
})

export default GlmIcon
