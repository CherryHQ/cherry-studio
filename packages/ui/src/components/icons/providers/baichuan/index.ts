import type { CompoundIcon } from '../../types'
import { Baichuan } from './color'
import { BaichuanMono } from './mono'

export const BaichuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baichuan, {
  Color: Baichuan,
  Mono: BaichuanMono,
  colorPrimary: '#000000'
})
export default BaichuanIcon
