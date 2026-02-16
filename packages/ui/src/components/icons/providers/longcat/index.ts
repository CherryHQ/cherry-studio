import type { CompoundIcon } from '../../types'
import { Longcat } from './color'
import { LongcatMono } from './mono'

export const LongcatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Longcat, {
  Color: Longcat,
  Mono: LongcatMono,
  colorPrimary: '#29E154'
})
export default LongcatIcon
