import { type CompoundIcon } from '../../types'
import { NotebooklmAvatar } from './avatar'
import { Notebooklm } from './color'
import { NotebooklmMono } from './mono'

export const NotebooklmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Notebooklm, {
  Color: Notebooklm,
  Mono: NotebooklmMono,
  Avatar: NotebooklmAvatar,
  colorPrimary: '#000000'
})

export default NotebooklmIcon
