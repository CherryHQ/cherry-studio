import { type CompoundIcon } from '../../types'
import { ArceeAiAvatar } from './avatar'
import { ArceeAi } from './color'
import { ArceeAiMono } from './mono'

export const ArceeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ArceeAi, {
  Color: ArceeAi,
  Mono: ArceeAiMono,
  Avatar: ArceeAiAvatar,
  colorPrimary: '#008C8C'
})

export default ArceeAiIcon
