import { type CompoundIcon } from '../../types'
import { KlingAvatar } from './avatar'
import { Kling } from './color'
import { KlingMono } from './mono'

export const KlingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kling, {
  Color: Kling,
  Mono: KlingMono,
  Avatar: KlingAvatar,
  colorPrimary: '#41D741'
})

export default KlingIcon
