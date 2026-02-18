import type { CompoundIcon } from '../../types'
import { JimengAvatar } from './avatar'
import { Jimeng } from './color'
import { JimengMono } from './mono'

export const JimengIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jimeng, {
  Color: Jimeng,
  Mono: JimengMono,
  Avatar: JimengAvatar,
  colorPrimary: '#000000'
})
export default JimengIcon
