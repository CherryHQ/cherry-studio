import type { CompoundIcon } from '../../types'
import { Lmstudio } from './color'
import { LmstudioMono } from './mono'

export const LmstudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lmstudio, {
  Color: Lmstudio,
  Mono: LmstudioMono,
  colorPrimary: '#6D7DF2'
})
export default LmstudioIcon
