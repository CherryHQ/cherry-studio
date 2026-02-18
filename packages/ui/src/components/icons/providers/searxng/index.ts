import type { CompoundIcon } from '../../types'
import { SearxngAvatar } from './avatar'
import { Searxng } from './color'
import { SearxngMono } from './mono'

export const SearxngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Searxng, {
  Color: Searxng,
  Mono: SearxngMono,
  Avatar: SearxngAvatar,
  colorPrimary: '#3050FF'
})
export default SearxngIcon
