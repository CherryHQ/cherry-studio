import { type CompoundIcon } from '../../types'
import { IdeogramAvatar } from './avatar'
import { Ideogram } from './color'
import { IdeogramMono } from './mono'

export const IdeogramIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ideogram, {
  Color: Ideogram,
  Mono: IdeogramMono,
  Avatar: IdeogramAvatar,
  colorPrimary: '#0e0e10'
})

export default IdeogramIcon
