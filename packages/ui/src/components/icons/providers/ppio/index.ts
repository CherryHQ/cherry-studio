import type { CompoundIcon } from '../../types'
import { Ppio } from './color'
import { PpioMono } from './mono'

export const PpioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ppio, {
  Color: Ppio,
  Mono: PpioMono,
  colorPrimary: '#0062E2'
})
export default PpioIcon
