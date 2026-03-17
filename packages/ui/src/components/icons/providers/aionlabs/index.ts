import { type CompoundIcon } from '../../types'
import { AionlabsAvatar } from './avatar'
import { Aionlabs } from './color'
import { AionlabsMono } from './mono'

export const AionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aionlabs, {
  Color: Aionlabs,
  Mono: AionlabsMono,
  Avatar: AionlabsAvatar,
  colorPrimary: '#0A1B2C'
})

export default AionlabsIcon
