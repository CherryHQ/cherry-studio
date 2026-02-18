import { type CompoundIcon } from '../../types'
import { TrinityAvatar } from './avatar'
import { Trinity } from './color'
import { TrinityMono } from './mono'

export const TrinityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Trinity, {
  Color: Trinity,
  Mono: TrinityMono,
  Avatar: TrinityAvatar,
  colorPrimary: '#000000'
})

export default TrinityIcon
