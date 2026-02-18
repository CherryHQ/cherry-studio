import type { CompoundIcon } from '../../types'
import { Ph8Avatar } from './avatar'
import { Ph8 } from './color'
import { Ph8Mono } from './mono'

export const Ph8Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ph8, {
  Color: Ph8,
  Mono: Ph8Mono,
  Avatar: Ph8Avatar,
  colorPrimary: '#00F0FF'
})
export default Ph8Icon
