import type { CompoundIcon } from '../../types'
import { PerplexityAvatar } from './avatar'
import { Perplexity } from './color'
import { PerplexityMono } from './mono'

export const PerplexityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Perplexity, {
  Color: Perplexity,
  Mono: PerplexityMono,
  Avatar: PerplexityAvatar,
  colorPrimary: '#20808D'
})
export default PerplexityIcon
