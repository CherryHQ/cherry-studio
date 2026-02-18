import type { CompoundIcon } from '../../types'
import { MinimaxAvatar } from './avatar'
import { Minimax } from './color'
import { MinimaxMono } from './mono'

export const MinimaxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Minimax, {
  Color: Minimax,
  Mono: MinimaxMono,
  Avatar: MinimaxAvatar,
  colorPrimary: '#000000'
})
export default MinimaxIcon
