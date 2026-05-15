import { type CompoundIcon } from '../../types'
import { OpenclawAvatar } from './avatar'
import { Openclaw } from './color'
import { OpenclawMono } from './mono'

export const OpenclawIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openclaw, {
  Color: Openclaw,
  Mono: OpenclawMono,
  Avatar: OpenclawAvatar,
  colorPrimary: '#ff4d4d'
})

export default OpenclawIcon
