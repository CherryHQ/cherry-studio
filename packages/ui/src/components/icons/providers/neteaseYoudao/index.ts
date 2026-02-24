import { type CompoundIcon } from '../../types'
import { NeteaseYoudaoAvatar } from './avatar'
import { NeteaseYoudao } from './color'
import { NeteaseYoudaoMono } from './mono'

export const NeteaseYoudaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NeteaseYoudao, {
  Color: NeteaseYoudao,
  Mono: NeteaseYoudaoMono,
  Avatar: NeteaseYoudaoAvatar,
  colorPrimary: '#E01E00'
})

export default NeteaseYoudaoIcon
