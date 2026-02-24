import { type CompoundIcon } from '../../types'
import { BaaiAvatar } from './avatar'
import { Baai } from './color'
import { BaaiMono } from './mono'

export const BaaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baai, {
  Color: Baai,
  Mono: BaaiMono,
  Avatar: BaaiAvatar,
  colorPrimary: '#000000'
})

export default BaaiIcon
