import type { CompoundIcon } from '../../types'
import { VolcengineAvatar } from './avatar'
import { Volcengine } from './color'
import { VolcengineMono } from './mono'

export const VolcengineIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Volcengine, {
  Color: Volcengine,
  Mono: VolcengineMono,
  Avatar: VolcengineAvatar,
  colorPrimary: '#00E5E5'
})
export default VolcengineIcon
