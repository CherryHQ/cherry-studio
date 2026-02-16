import type { CompoundIcon } from '../../types'
import { Nvidia } from './color'
import { NvidiaMono } from './mono'

export const NvidiaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nvidia, {
  Color: Nvidia,
  Mono: NvidiaMono,
  colorPrimary: '#76B900'
})
export default NvidiaIcon
