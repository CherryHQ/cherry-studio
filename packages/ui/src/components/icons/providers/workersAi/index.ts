import type { CompoundIcon } from '../../types'
import { WorkersAiAvatar } from './avatar'
import { WorkersAi } from './color'
import { WorkersAiMono } from './mono'

export const WorkersAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(WorkersAi, {
  Color: WorkersAi,
  Mono: WorkersAiMono,
  Avatar: WorkersAiAvatar,
  colorPrimary: '#F38020'
})
export default WorkersAiIcon
