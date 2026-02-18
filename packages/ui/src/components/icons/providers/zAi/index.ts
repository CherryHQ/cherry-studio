import { type CompoundIcon } from '../../types'
import { ZAiAvatar } from './avatar'
import { ZAi } from './color'
import { ZAiMono } from './mono'

export const ZAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ZAi, {
  Color: ZAi,
  Mono: ZAiMono,
  Avatar: ZAiAvatar,
  colorPrimary: '#000000'
})

export default ZAiIcon
