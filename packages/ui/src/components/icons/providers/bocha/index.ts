import type { CompoundIcon } from '../../types'
import { Bocha } from './color'
import { BochaMono } from './mono'

export const BochaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bocha, {
  Color: Bocha,
  Mono: BochaMono,
  colorPrimary: '#A5CCFF'
})
export default BochaIcon
