import type { CompoundIcon } from '../../types'
import { GiteeAiAvatar } from './avatar'
import { GiteeAi } from './color'
import { GiteeAiMono } from './mono'

export const GiteeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GiteeAi, {
  Color: GiteeAi,
  Mono: GiteeAiMono,
  Avatar: GiteeAiAvatar,
  colorPrimary: '#000000'
})
export default GiteeAiIcon
