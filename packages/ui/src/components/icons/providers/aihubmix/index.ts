import { type CompoundIcon } from '../../types'
import { AihubmixAvatar } from './avatar'
import { Aihubmix } from './color'
import { AihubmixMono } from './mono'

export const AihubmixIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aihubmix, {
  Color: Aihubmix,
  Mono: AihubmixMono,
  Avatar: AihubmixAvatar,
  colorPrimary: '#006FFB'
})

export default AihubmixIcon
