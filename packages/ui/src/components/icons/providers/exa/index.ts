import type { CompoundIcon } from '../../types'
import { Exa } from './color'
import { ExaMono } from './mono'

export const ExaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Exa, {
  Color: Exa,
  Mono: ExaMono,
  colorPrimary: '#1F40ED'
})
export default ExaIcon
