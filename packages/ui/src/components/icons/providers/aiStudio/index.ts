import { type CompoundIcon } from '../../types'
import { AiStudioAvatar } from './avatar'
import { AiStudio } from './color'
import { AiStudioMono } from './mono'

export const AiStudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiStudio, {
  Color: AiStudio,
  Mono: AiStudioMono,
  Avatar: AiStudioAvatar,
  colorPrimary: '#1A1A1A'
})

export default AiStudioIcon
