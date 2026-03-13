import { type CompoundIcon } from '../../types'
import { EssentialAiAvatar } from './avatar'
import { EssentialAi } from './color'
import { EssentialAiMono } from './mono'

export const EssentialAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(EssentialAi, {
  Color: EssentialAi,
  Mono: EssentialAiMono,
  Avatar: EssentialAiAvatar,
  colorPrimary: '#35058E'
})

export default EssentialAiIcon
