import type { CompoundIcon } from '../../types'
import { ExaAvatar } from './avatar'
import { Exa } from './color'
import { ExaMono } from './mono'

export const ExaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Exa, {
  Color: Exa,
  Mono: ExaMono,
  Avatar: ExaAvatar,
  colorPrimary: '#1F40ED'
})
export default ExaIcon
