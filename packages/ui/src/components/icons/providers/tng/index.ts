import type { CompoundIcon } from '../../types'
import { Tng } from './color'
import { TngMono } from './mono'

export const TngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tng, {
  Color: Tng,
  Mono: TngMono,
  colorPrimary: '#FDFEFE'
})
export default TngIcon
