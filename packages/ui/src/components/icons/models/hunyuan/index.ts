import { type CompoundIcon } from '../../types'
import { HunyuanAvatar } from './avatar'
import { Hunyuan } from './color'
import { HunyuanMono } from './mono'

export const HunyuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hunyuan, {
  Color: Hunyuan,
  Mono: HunyuanMono,
  Avatar: HunyuanAvatar,
  colorPrimary: '#0054E0'
})

export default HunyuanIcon
