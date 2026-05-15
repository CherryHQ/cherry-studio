import { type CompoundIcon } from '../../types'
import { Gpt5ChatAvatar } from './avatar'
import { Gpt5Chat } from './color'
import { Gpt5ChatMono } from './mono'

export const Gpt5ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Chat, {
  Color: Gpt5Chat,
  Mono: Gpt5ChatMono,
  Avatar: Gpt5ChatAvatar,
  colorPrimary: '#FB75A3'
})

export default Gpt5ChatIcon
