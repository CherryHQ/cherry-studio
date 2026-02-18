import type { CompoundIcon } from '../../types'
import { HuggingfaceAvatar } from './avatar'
import { Huggingface } from './color'
import { HuggingfaceMono } from './mono'

export const HuggingfaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Huggingface, {
  Color: Huggingface,
  Mono: HuggingfaceMono,
  Avatar: HuggingfaceAvatar,
  colorPrimary: '#FFD21E'
})
export default HuggingfaceIcon
