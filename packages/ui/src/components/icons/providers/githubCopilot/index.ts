import { type CompoundIcon } from '../../types'
import { GithubCopilotAvatar } from './avatar'
import { GithubCopilot } from './color'
import { GithubCopilotMono } from './mono'

export const GithubCopilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GithubCopilot, {
  Color: GithubCopilot,
  Mono: GithubCopilotMono,
  Avatar: GithubCopilotAvatar,
  colorPrimary: '#000000'
})

export default GithubCopilotIcon
