import type { CompoundIcon } from '../../types'
import { OllamaAvatar } from './avatar'
import { Ollama } from './color'
import { OllamaMono } from './mono'

export const OllamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ollama, {
  Color: Ollama,
  Mono: OllamaMono,
  Avatar: OllamaAvatar,
  colorPrimary: '#000000'
})
export default OllamaIcon
