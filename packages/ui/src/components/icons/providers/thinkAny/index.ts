import { type CompoundIcon } from '../../types'
import { ThinkAnyAvatar } from './avatar'
import { ThinkAny } from './color'
import { ThinkAnyMono } from './mono'

export const ThinkAnyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ThinkAny, {
  Color: ThinkAny,
  Mono: ThinkAnyMono,
  Avatar: ThinkAnyAvatar,
  colorPrimary: '#6294F5'
})

export default ThinkAnyIcon
