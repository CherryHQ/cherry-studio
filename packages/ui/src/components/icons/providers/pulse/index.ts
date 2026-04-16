import { type CompoundIcon } from '../../types'
import { PulseAvatar } from './avatar'
import { Pulse } from './color'
import { PulseMono } from './mono'

export const PulseIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Pulse, {
  Color: Pulse,
  Mono: PulseMono,
  Avatar: PulseAvatar,
  colorPrimary: '#302F7D'
})

export default PulseIcon
