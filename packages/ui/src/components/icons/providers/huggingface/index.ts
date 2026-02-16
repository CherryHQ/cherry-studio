import type { CompoundIcon } from '../../types'
import { Huggingface } from './color'
import { HuggingfaceMono } from './mono'

export const HuggingfaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Huggingface, {
  Color: Huggingface,
  Mono: HuggingfaceMono,
  colorPrimary: '#FFD21E'
})
export default HuggingfaceIcon
