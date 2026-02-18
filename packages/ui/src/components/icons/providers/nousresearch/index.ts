import type { CompoundIcon } from '../../types'
import { NousresearchAvatar } from './avatar'
import { Nousresearch } from './color'
import { NousresearchMono } from './mono'

export const NousresearchIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nousresearch, {
  Color: Nousresearch,
  Mono: NousresearchMono,
  Avatar: NousresearchAvatar,
  colorPrimary: '#2D6376'
})
export default NousresearchIcon
