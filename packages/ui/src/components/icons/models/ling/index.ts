import { type CompoundIcon } from '../../types'
import { LingAvatar } from './avatar'
import { Ling } from './color'
import { LingMono } from './mono'

export const LingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ling, {
  Color: Ling,
  Mono: LingMono,
  Avatar: LingAvatar,
  colorPrimary: '#0C73FF'
})

export default LingIcon
