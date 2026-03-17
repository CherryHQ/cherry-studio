import { type CompoundIcon } from '../../types'
import { MistralAvatar } from './avatar'
import { Mistral } from './color'
import { MistralMono } from './mono'

export const MistralIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mistral, {
  Color: Mistral,
  Mono: MistralMono,
  Avatar: MistralAvatar,
  colorPrimary: '#FA500F'
})

export default MistralIcon
