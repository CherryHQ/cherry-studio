import { type CompoundIcon } from '../../types'
import { SiliconAvatar } from './avatar'
import { Silicon } from './color'
import { SiliconMono } from './mono'

export const SiliconIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Silicon, {
  Color: Silicon,
  Mono: SiliconMono,
  Avatar: SiliconAvatar,
  colorPrimary: '#6E29F6'
})

export default SiliconIcon
