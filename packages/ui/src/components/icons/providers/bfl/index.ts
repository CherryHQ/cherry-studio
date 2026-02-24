import { type CompoundIcon } from '../../types'
import { BflAvatar } from './avatar'
import { Bfl } from './color'
import { BflMono } from './mono'

export const BflIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bfl, {
  Color: Bfl,
  Mono: BflMono,
  Avatar: BflAvatar,
  colorPrimary: '#000000'
})

export default BflIcon
