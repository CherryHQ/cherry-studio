import type { CompoundIcon } from '../../types'
import { Mineru } from './color'
import { MineruMono } from './mono'

export const MineruIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mineru, {
  Color: Mineru,
  Mono: MineruMono,
  colorPrimary: '#000000'
})
export default MineruIcon
