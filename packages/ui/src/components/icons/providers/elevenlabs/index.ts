import { type CompoundIcon } from '../../types'
import { ElevenlabsAvatar } from './avatar'
import { Elevenlabs } from './color'
import { ElevenlabsMono } from './mono'

export const ElevenlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Elevenlabs, {
  Color: Elevenlabs,
  Mono: ElevenlabsMono,
  Avatar: ElevenlabsAvatar,
  colorPrimary: '#000000'
})

export default ElevenlabsIcon
