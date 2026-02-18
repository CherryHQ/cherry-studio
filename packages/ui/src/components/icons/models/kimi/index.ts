import type { CompoundIcon } from '../../types'
import { KimiAvatar } from './avatar'
import { Kimi } from './color'
import { KimiMono } from './mono'

export const KimiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kimi, {
  Color: Kimi,
  Mono: KimiMono,
  Avatar: KimiAvatar,
  colorPrimary: '#000000'
})
export default KimiIcon
