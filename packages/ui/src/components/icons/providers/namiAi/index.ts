import { type CompoundIcon } from '../../types'
import { NamiAiAvatar } from './avatar'
import { NamiAi } from './color'
import { NamiAiMono } from './mono'

export const NamiAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(NamiAi, {
  Color: NamiAi,
  Mono: NamiAiMono,
  Avatar: NamiAiAvatar,
  colorPrimary: '#000000'
})

export default NamiAiIcon
