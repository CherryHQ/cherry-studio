import type { CompoundIcon } from '../../types'
import { Claude } from './color'
import { ClaudeMono } from './mono'

export const ClaudeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Claude, {
  Color: Claude,
  Mono: ClaudeMono,
  colorPrimary: '#d97757'
})
export default ClaudeIcon
