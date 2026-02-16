import type { CompoundIcon } from '../../types'
import { Tavily } from './color'
import { TavilyMono } from './mono'

export const TavilyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tavily, {
  Color: Tavily,
  Mono: TavilyMono,
  colorPrimary: '#8FBCFA'
})
export default TavilyIcon
