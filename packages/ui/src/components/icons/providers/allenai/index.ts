import type { CompoundIcon } from '../../types'
import { AllenaiAvatar } from './avatar'
import { Allenai } from './color'
import { AllenaiMono } from './mono'

export const AllenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Allenai, {
  Color: Allenai,
  Mono: AllenaiMono,
  Avatar: AllenaiAvatar,
  colorPrimary: '#F8F0E9'
})
export default AllenaiIcon
