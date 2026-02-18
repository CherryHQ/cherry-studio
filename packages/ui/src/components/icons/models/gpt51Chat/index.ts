import type { CompoundIcon } from '../../types'
import { Gpt51ChatAvatar } from './avatar'
import { Gpt51Chat } from './color'
import { Gpt51ChatMono } from './mono'

export const Gpt51ChatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51Chat, {
  Color: Gpt51Chat,
  Mono: Gpt51ChatMono,
  Avatar: Gpt51ChatAvatar,
  colorPrimary: '#EECDCE'
})
export default Gpt51ChatIcon
