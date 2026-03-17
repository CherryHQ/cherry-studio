import { type CompoundIcon } from '../../types'
import { DolphinAiAvatar } from './avatar'
import { DolphinAi } from './color'
import { DolphinAiMono } from './mono'

export const DolphinAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(DolphinAi, {
  Color: DolphinAi,
  Mono: DolphinAiMono,
  Avatar: DolphinAiAvatar,
  colorPrimary: '#6281F6'
})

export default DolphinAiIcon
