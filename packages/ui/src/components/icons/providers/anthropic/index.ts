import type { CompoundIcon } from '../../types'
import { Anthropic } from './color'
import { AnthropicMono } from './mono'

export const AnthropicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anthropic, {
  Color: Anthropic,
  Mono: AnthropicMono,
  colorPrimary: '#CA9F7B'
})
export default AnthropicIcon
