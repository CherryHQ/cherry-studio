import { type CompoundIcon } from '../../types'
import { StabilityAvatar } from './avatar'
import { Stability } from './color'
import { StabilityMono } from './mono'

export const StabilityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Stability, {
  Color: Stability,
  Mono: StabilityMono,
  Avatar: StabilityAvatar,
  colorPrimary: '#e80000'
})

export default StabilityIcon
