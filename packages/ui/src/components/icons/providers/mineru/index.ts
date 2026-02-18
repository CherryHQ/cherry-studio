import type { CompoundIcon } from '../../types'
import { MineruAvatar } from './avatar'
import { Mineru } from './color'
import { MineruMono } from './mono'

export const MineruIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mineru, {
  Color: Mineru,
  Mono: MineruMono,
  Avatar: MineruAvatar,
  colorPrimary: '#000000'
})
export default MineruIcon
