import { type CompoundIcon } from '../../types'
import { MinimaxAgentAvatar } from './avatar'
import { MinimaxAgent } from './color'
import { MinimaxAgentMono } from './mono'

export const MinimaxAgentIcon: CompoundIcon = /*#__PURE__*/ Object.assign(MinimaxAgent, {
  Color: MinimaxAgent,
  Mono: MinimaxAgentMono,
  Avatar: MinimaxAgentAvatar,
  colorPrimary: '#7ec7ff'
})

export default MinimaxAgentIcon
