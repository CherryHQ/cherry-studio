import type { CompoundIcon } from '../../types'
import { AiOnlyAvatar } from './avatar'
import { AiOnly } from './color'
import { AiOnlyMono } from './mono'

export const AiOnlyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiOnly, {
  Color: AiOnly,
  Mono: AiOnlyMono,
  Avatar: AiOnlyAvatar,
  colorPrimary: '#00E5E5'
})
export default AiOnlyIcon
