import type { CompoundIcon } from '../../types'
import { Mistral } from './color'
import { MistralMono } from './mono'

export const MistralIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mistral, {
  Color: Mistral,
  Mono: MistralMono,
  colorPrimary: '#FA500F'
})
export default MistralIcon
