import type { CompoundIcon } from '../../types'
import { Doc2x } from './color'
import { Doc2xMono } from './mono'

export const Doc2xIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doc2x, {
  Color: Doc2x,
  Mono: Doc2xMono,
  colorPrimary: '#7748F9'
})
export default Doc2xIcon
