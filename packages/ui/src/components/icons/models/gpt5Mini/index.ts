import type { CompoundIcon } from '../../types'
import { Gpt5MiniAvatar } from './avatar'
import { Gpt5Mini } from './color'
import { Gpt5MiniMono } from './mono'

export const Gpt5MiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Mini, {
  Color: Gpt5Mini,
  Mono: Gpt5MiniMono,
  Avatar: Gpt5MiniAvatar,
  colorPrimary: '#EA74EF'
})
export default Gpt5MiniIcon
