import type { CompoundIcon } from '../../types'
import { GrokAvatar } from './avatar'
import { Grok } from './color'
import { GrokMono } from './mono'

export const GrokIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Grok, {
  Color: Grok,
  Mono: GrokMono,
  Avatar: GrokAvatar,
  colorPrimary: '#000000'
})
export default GrokIcon
