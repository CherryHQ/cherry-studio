import { type CompoundIcon } from '../../types'
import { InternlmAvatar } from './avatar'
import { Internlm } from './color'
import { InternlmMono } from './mono'

export const InternlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Internlm, {
  Color: Internlm,
  Mono: InternlmMono,
  Avatar: InternlmAvatar,
  colorPrimary: '#858599'
})

export default InternlmIcon
