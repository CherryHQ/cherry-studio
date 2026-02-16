import type { CompoundIcon } from '../../types'
import { GraphRag } from './color'
import { GraphRagMono } from './mono'

export const GraphRagIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GraphRag, {
  Color: GraphRag,
  Mono: GraphRagMono,
  colorPrimary: '#F8E71C'
})
export default GraphRagIcon
