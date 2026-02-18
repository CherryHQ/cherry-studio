import { type CompoundIcon } from '../../types'
import { RunawayAvatar } from './avatar'
import { Runaway } from './color'
import { RunawayMono } from './mono'

export const RunawayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Runaway, {
  Color: Runaway,
  Mono: RunawayMono,
  Avatar: RunawayAvatar,
  colorPrimary: '#ECEBE3'
})

export default RunawayIcon
