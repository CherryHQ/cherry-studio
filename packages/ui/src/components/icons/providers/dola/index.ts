import { type CompoundIcon } from '../../types'
import { DolaAvatar } from './avatar'
import { Dola } from './color'
import { DolaMono } from './mono'

export const DolaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dola, {
  Color: Dola,
  Mono: DolaMono,
  Avatar: DolaAvatar,
  colorPrimary: '#EEC6BB'
})

export default DolaIcon
