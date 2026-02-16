import type { CompoundIcon } from '../../types'
import { Sophnet } from './color'
import { SophnetMono } from './mono'

export const SophnetIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sophnet, {
  Color: Sophnet,
  Mono: SophnetMono,
  colorPrimary: '#6200EE'
})
export default SophnetIcon
