import { type CompoundIcon } from '../../types'
import { HigressAvatar } from './avatar'
import { Higress } from './color'
import { HigressMono } from './mono'

export const HigressIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Higress, {
  Color: Higress,
  Mono: HigressMono,
  Avatar: HigressAvatar,
  colorPrimary: '#3E5CF4'
})

export default HigressIcon
