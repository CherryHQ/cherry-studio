import { type CompoundIcon } from '../../types'
import { GlamaAvatar } from './avatar'
import { Glama } from './color'
import { GlamaMono } from './mono'

export const GlamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glama, {
  Color: Glama,
  Mono: GlamaMono,
  Avatar: GlamaAvatar,
  colorPrimary: '#000000'
})

export default GlamaIcon
