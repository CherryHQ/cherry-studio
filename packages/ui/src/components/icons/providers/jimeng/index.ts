import type { CompoundIcon } from '../../types'
import { Jimeng } from './color'
import { JimengMono } from './mono'

export const JimengIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Jimeng, {
  Color: Jimeng,
  Mono: JimengMono,
  colorPrimary: '#000000'
})
export default JimengIcon
