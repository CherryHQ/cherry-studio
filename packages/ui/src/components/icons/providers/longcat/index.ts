import type { CompoundIcon } from '../../types'
import { LongcatAvatar } from './avatar'
import { Longcat } from './color'
import { LongcatMono } from './mono'

export const LongcatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Longcat, {
  Color: Longcat,
  Mono: LongcatMono,
  Avatar: LongcatAvatar,
  colorPrimary: '#29E154'
})
export default LongcatIcon
