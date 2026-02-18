import type { CompoundIcon } from '../../types'
import { FireworksAvatar } from './avatar'
import { Fireworks } from './color'
import { FireworksMono } from './mono'

export const FireworksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Fireworks, {
  Color: Fireworks,
  Mono: FireworksMono,
  Avatar: FireworksAvatar,
  colorPrimary: '#5019C5'
})
export default FireworksIcon
