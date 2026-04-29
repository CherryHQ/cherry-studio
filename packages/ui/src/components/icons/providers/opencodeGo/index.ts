import { type CompoundIcon } from '../../types'
import { OpencodeGoAvatar } from './avatar'
import { OpencodeGo } from './color'
import { OpencodeGoMono } from './mono'

export const OpencodeGoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(OpencodeGo, {
  Color: OpencodeGo,
  Mono: OpencodeGoMono,
  Avatar: OpencodeGoAvatar,
  colorPrimary: '#131010'
})

export default OpencodeGoIcon
