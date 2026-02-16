import type { CompoundIcon } from '../../types'
import { Intel } from './color'
import { IntelMono } from './mono'

export const IntelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Intel, {
  Color: Intel,
  Mono: IntelMono,
  colorPrimary: '#000000'
})
export default IntelIcon
