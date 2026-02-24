import { type CompoundIcon } from '../../types'
import { YouAvatar } from './avatar'
import { You } from './color'
import { YouMono } from './mono'

export const YouIcon: CompoundIcon = /*#__PURE__*/ Object.assign(You, {
  Color: You,
  Mono: YouMono,
  Avatar: YouAvatar,
  colorPrimary: '#717EEA'
})

export default YouIcon
