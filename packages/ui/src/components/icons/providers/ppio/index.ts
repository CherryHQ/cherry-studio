import type { CompoundIcon } from '../../types'
import { PpioAvatar } from './avatar'
import { Ppio } from './color'
import { PpioMono } from './mono'

export const PpioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ppio, {
  Color: Ppio,
  Mono: PpioMono,
  Avatar: PpioAvatar,
  colorPrimary: '#0062E2'
})
export default PpioIcon
