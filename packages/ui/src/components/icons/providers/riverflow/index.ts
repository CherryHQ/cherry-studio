import { type CompoundIcon } from '../../types'
import { RiverflowAvatar } from './avatar'
import { Riverflow } from './color'
import { RiverflowMono } from './mono'

export const RiverflowIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Riverflow, {
  Color: Riverflow,
  Mono: RiverflowMono,
  Avatar: RiverflowAvatar,
  colorPrimary: '#1F0909'
})

export default RiverflowIcon
