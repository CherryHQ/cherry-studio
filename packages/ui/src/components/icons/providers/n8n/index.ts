import { type CompoundIcon } from '../../types'
import { N8nAvatar } from './avatar'
import { N8n } from './color'
import { N8nMono } from './mono'

export const N8nIcon: CompoundIcon = /*#__PURE__*/ Object.assign(N8n, {
  Color: N8n,
  Mono: N8nMono,
  Avatar: N8nAvatar,
  colorPrimary: '#EB4A70'
})

export default N8nIcon
