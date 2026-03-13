import { type CompoundIcon } from '../../types'
import { McpsoAvatar } from './avatar'
import { Mcpso } from './color'
import { McpsoMono } from './mono'

export const McpsoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcpso, {
  Color: Mcpso,
  Mono: McpsoMono,
  Avatar: McpsoAvatar,
  colorPrimary: '#3D5D83'
})

export default McpsoIcon
