import { type CompoundIcon } from '../../types'
import { SmitheryAvatar } from './avatar'
import { Smithery } from './color'
import { SmitheryMono } from './mono'

export const SmitheryIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Smithery, {
  Color: Smithery,
  Mono: SmitheryMono,
  Avatar: SmitheryAvatar,
  colorPrimary: '#FF5601'
})

export default SmitheryIcon
