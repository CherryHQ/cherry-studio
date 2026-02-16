import type { CompoundIcon } from '../../types'
import { Relace } from './color'
import { RelaceMono } from './mono'

export const RelaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Relace, {
  Color: Relace,
  Mono: RelaceMono,
  colorPrimary: '#020202'
})
export default RelaceIcon
