import type { CompoundIcon } from '../../types'
import { Macos } from './color'
import { MacosMono } from './mono'

export const MacosIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Macos, {
  Color: Macos,
  Mono: MacosMono,
  colorPrimary: '#000000'
})
export default MacosIcon
