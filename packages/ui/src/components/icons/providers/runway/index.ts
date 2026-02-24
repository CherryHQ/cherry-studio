import { type CompoundIcon } from '../../types'
import { RunwayAvatar } from './avatar'
import { Runway } from './color'
import { RunwayMono } from './mono'

export const RunwayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Runway, {
  Color: Runway,
  Mono: RunwayMono,
  Avatar: RunwayAvatar,
  colorPrimary: '#000000'
})

export default RunwayIcon
