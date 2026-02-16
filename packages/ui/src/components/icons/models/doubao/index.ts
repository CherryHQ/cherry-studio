import type { CompoundIcon } from '../../types'
import { Doubao } from './color'
import { DoubaoMono } from './mono'

export const DoubaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doubao, {
  Color: Doubao,
  Mono: DoubaoMono,
  colorPrimary: '#1E37FC'
})
export default DoubaoIcon
