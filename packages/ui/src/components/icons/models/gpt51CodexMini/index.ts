import type { CompoundIcon } from '../../types'
import { Gpt51CodexMiniAvatar } from './avatar'
import { Gpt51CodexMini } from './color'
import { Gpt51CodexMiniMono } from './mono'

export const Gpt51CodexMiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51CodexMini, {
  Color: Gpt51CodexMini,
  Mono: Gpt51CodexMiniMono,
  Avatar: Gpt51CodexMiniAvatar,
  colorPrimary: '#F0B5CD'
})
export default Gpt51CodexMiniIcon
