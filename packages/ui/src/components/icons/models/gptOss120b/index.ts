import { type CompoundIcon } from '../../types'
import { GptOss120bAvatar } from './avatar'
import { GptOss120b } from './color'
import { GptOss120bMono } from './mono'

export const GptOss120bIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GptOss120b, {
  Color: GptOss120b,
  Mono: GptOss120bMono,
  Avatar: GptOss120bAvatar,
  colorPrimary: '#ABF8FE'
})

export default GptOss120bIcon
