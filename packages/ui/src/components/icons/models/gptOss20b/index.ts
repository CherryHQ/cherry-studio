import { type CompoundIcon } from '../../types'
import { GptOss20bAvatar } from './avatar'
import { GptOss20b } from './color'
import { GptOss20bMono } from './mono'

export const GptOss20bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss20b, {
  Color: GptOss20b,
  Mono: GptOss20bMono,
  Avatar: GptOss20bAvatar,
  colorPrimary: '#A5F5FE'
})

export default GptOss20bIcon
