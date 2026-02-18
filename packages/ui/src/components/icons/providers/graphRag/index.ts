import type { CompoundIcon } from '../../types'
import { GraphRagAvatar } from './avatar'
import { GraphRag } from './color'
import { GraphRagMono } from './mono'

export const GraphRagIcon: CompoundIcon = /*#__PURE__*/ Object.assign(GraphRag, {
  Color: GraphRag,
  Mono: GraphRagMono,
  Avatar: GraphRagAvatar,
  colorPrimary: '#F8E71C'
})
export default GraphRagIcon
