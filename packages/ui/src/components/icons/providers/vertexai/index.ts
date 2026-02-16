import type { CompoundIcon } from '../../types'
import { Vertexai } from './color'
import { VertexaiMono } from './mono'

export const VertexaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vertexai, {
  Color: Vertexai,
  Mono: VertexaiMono,
  colorPrimary: '#4285F4'
})
export default VertexaiIcon
