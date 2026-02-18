import type { CompoundIcon } from '../../types'
import { VertexaiAvatar } from './avatar'
import { Vertexai } from './color'
import { VertexaiMono } from './mono'

export const VertexaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vertexai, {
  Color: Vertexai,
  Mono: VertexaiMono,
  Avatar: VertexaiAvatar,
  colorPrimary: '#4285F4'
})
export default VertexaiIcon
