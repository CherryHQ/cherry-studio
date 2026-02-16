import type { CompoundIcon } from '../../types'
import { Minimax } from './color'
import { MinimaxMono } from './mono'

export const MinimaxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Minimax, {
  Color: Minimax,
  Mono: MinimaxMono,
  colorPrimary: '#000000'
})
export default MinimaxIcon
