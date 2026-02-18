import { type CompoundIcon } from '../../types'
import { SophnetAvatar } from './avatar'
import { Sophnet } from './color'
import { SophnetMono } from './mono'

export const SophnetIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sophnet, {
  Color: Sophnet,
  Mono: SophnetMono,
  Avatar: SophnetAvatar,
  colorPrimary: '#6200EE'
})

export default SophnetIcon
