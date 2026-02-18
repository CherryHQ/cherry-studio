import type { CompoundIcon } from '../../types'
import { GroqAvatar } from './avatar'
import { Groq } from './color'
import { GroqMono } from './mono'

export const GroqIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Groq, {
  Color: Groq,
  Mono: GroqMono,
  Avatar: GroqAvatar,
  colorPrimary: '#F54F35'
})
export default GroqIcon
