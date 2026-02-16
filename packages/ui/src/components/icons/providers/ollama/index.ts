import type { CompoundIcon } from '../../types'
import { Ollama } from './color'
import { OllamaMono } from './mono'

export const OllamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ollama, {
  Color: Ollama,
  Mono: OllamaMono,
  colorPrimary: '#000000'
})
export default OllamaIcon
