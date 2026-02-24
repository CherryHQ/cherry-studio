import { type CompoundIcon } from '../../types'
import { BytedanceAvatar } from './avatar'
import { Bytedance } from './color'
import { BytedanceMono } from './mono'

export const BytedanceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bytedance, {
  Color: Bytedance,
  Mono: BytedanceMono,
  Avatar: BytedanceAvatar,
  colorPrimary: '#00C8D2'
})

export default BytedanceIcon
