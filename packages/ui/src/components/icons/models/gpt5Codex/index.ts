import type { CompoundIcon } from '../../types'
import { Gpt5CodexAvatar } from './avatar'
import { Gpt5Codex } from './color'
import { Gpt5CodexMono } from './mono'

export const Gpt5CodexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Codex, {
  Color: Gpt5Codex,
  Mono: Gpt5CodexMono,
  Avatar: Gpt5CodexAvatar,
  colorPrimary: '#D0B4F8'
})
export default Gpt5CodexIcon
