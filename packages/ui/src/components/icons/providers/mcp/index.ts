import { type CompoundIcon } from '../../types'
import { McpAvatar } from './avatar'
import { Mcp } from './color'
import { McpMono } from './mono'

export const McpIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mcp, {
  Color: Mcp,
  Mono: McpMono,
  Avatar: McpAvatar,
  colorPrimary: '#020202'
})

export default McpIcon
