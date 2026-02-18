import { type CompoundIcon } from '../../types'
import { ViduAvatar } from './avatar'
import { Vidu } from './color'
import { ViduMono } from './mono'

export const ViduIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vidu, {
  Color: Vidu,
  Mono: ViduMono,
  Avatar: ViduAvatar,
  colorPrimary: '#000102'
})

export default ViduIcon
