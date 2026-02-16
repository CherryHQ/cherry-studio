import type { CompoundIcon } from '../../types'
import { Palm } from './color'
import { PalmMono } from './mono'

export const PalmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Palm, {
  Color: Palm,
  Mono: PalmMono,
  colorPrimary: '#FEFEFE'
})
export default PalmIcon
