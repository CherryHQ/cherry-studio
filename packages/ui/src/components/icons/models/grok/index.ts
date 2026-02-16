import type { CompoundIcon } from '../../types'
import { Grok } from './color'
import { GrokMono } from './mono'

export const GrokIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Grok, {
  Color: Grok,
  Mono: GrokMono,
  colorPrimary: '#050505'
})
export default GrokIcon
