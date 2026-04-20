import { type CompoundIcon } from '../../types'
import { TavilyAvatar } from './avatar'
import { Tavily } from './color'
import { TavilyMono } from './mono'

export const TavilyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tavily, {
  Color: Tavily,
  Mono: TavilyMono,
  Avatar: TavilyAvatar,
  colorPrimary: '#8FBCFA'
})

export default TavilyIcon
