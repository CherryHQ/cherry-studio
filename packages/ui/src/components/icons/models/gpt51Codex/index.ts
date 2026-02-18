import type { CompoundIcon } from '../../types'
import { Gpt51CodexAvatar } from './avatar'
import { Gpt51Codex } from './color'
import { Gpt51CodexMono } from './mono'

export const Gpt51CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Codex, {
  Color: Gpt51Codex,
  Mono: Gpt51CodexMono,
  Avatar: Gpt51CodexAvatar,
  colorPrimary: '#F0A9A2'
})
export default Gpt51CodexIcon
