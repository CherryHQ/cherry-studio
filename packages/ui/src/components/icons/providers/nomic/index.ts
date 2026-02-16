import type { CompoundIcon } from '../../types'
import { Nomic } from './color'
import { NomicMono } from './mono'

export const NomicIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nomic, {
  Color: Nomic,
  Mono: NomicMono,
  colorPrimary: '#000000'
})
export default NomicIcon
