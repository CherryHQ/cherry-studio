import type { CompoundIcon } from '../../types'
import { JinaAvatar } from './avatar'
import { Jina } from './color'
import { JinaMono } from './mono'

export const JinaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jina, {
  Color: Jina,
  Mono: JinaMono,
  Avatar: JinaAvatar,
  colorPrimary: '#EB6161'
})
export default JinaIcon
