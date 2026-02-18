import type { CompoundIcon } from '../../types'
import { InflectionAvatar } from './avatar'
import { Inflection } from './color'
import { InflectionMono } from './mono'

export const InflectionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inflection, {
  Color: Inflection,
  Mono: InflectionMono,
  Avatar: InflectionAvatar,
  colorPrimary: '#231F20'
})
export default InflectionIcon
