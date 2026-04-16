import { type CompoundIcon } from '../../types'
import { ComposioAvatar } from './avatar'
import { Composio } from './color'
import { ComposioMono } from './mono'

export const ComposioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Composio, {
  Color: Composio,
  Mono: ComposioMono,
  Avatar: ComposioAvatar,
  colorPrimary: '#171313'
})

export default ComposioIcon
