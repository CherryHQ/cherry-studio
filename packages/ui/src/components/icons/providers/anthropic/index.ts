import { type CompoundIcon } from '../../types'
import { AnthropicAvatar } from './avatar'
import { Anthropic } from './color'
import { AnthropicMono } from './mono'

export const AnthropicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Anthropic, {
  Color: Anthropic,
  Mono: AnthropicMono,
  Avatar: AnthropicAvatar,
  colorPrimary: '#CA9F7B'
})

export default AnthropicIcon
