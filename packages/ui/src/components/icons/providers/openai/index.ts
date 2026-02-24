import { type CompoundIcon } from '../../types'
import { OpenaiAvatar } from './avatar'
import { Openai } from './color'
import { OpenaiMono } from './mono'

export const OpenaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openai, {
  Color: Openai,
  Mono: OpenaiMono,
  Avatar: OpenaiAvatar,
  colorPrimary: '#000000'
})

export default OpenaiIcon
