import type { CompoundIcon } from '../../types'
import { HailuoAvatar } from './avatar'
import { Hailuo } from './color'
import { HailuoMono } from './mono'

export const HailuoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hailuo, {
  Color: Hailuo,
  Mono: HailuoMono,
  Avatar: HailuoAvatar,
  colorPrimary: '#000000'
})
export default HailuoIcon
