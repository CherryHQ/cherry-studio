import { type CompoundIcon } from '../../types'
import { InfiniAvatar } from './avatar'
import { Infini } from './color'
import { InfiniMono } from './mono'

export const InfiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Infini, {
  Color: Infini,
  Mono: InfiniMono,
  Avatar: InfiniAvatar,
  colorPrimary: '#6A3CFD'
})

export default InfiniIcon
