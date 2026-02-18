import type { CompoundIcon } from '../../types'
import { ClaudeAvatar } from './avatar'
import { Claude } from './color'
import { ClaudeMono } from './mono'

export const ClaudeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Claude, {
  Color: Claude,
  Mono: ClaudeMono,
  Avatar: ClaudeAvatar,
  colorPrimary: '#d97757'
})
export default ClaudeIcon
