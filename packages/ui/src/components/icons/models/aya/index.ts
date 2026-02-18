import type { CompoundIcon } from '../../types'
import { AyaAvatar } from './avatar'
import { Aya } from './color'
import { AyaMono } from './mono'

export const AyaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Aya, {
  Color: Aya,
  Mono: AyaMono,
  Avatar: AyaAvatar,
  colorPrimary: '#010201'
})
export default AyaIcon
