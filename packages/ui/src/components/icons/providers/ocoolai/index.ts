import type { CompoundIcon } from '../../types'
import { OcoolaiAvatar } from './avatar'
import { Ocoolai } from './color'
import { OcoolaiMono } from './mono'

export const OcoolaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ocoolai, {
  Color: Ocoolai,
  Mono: OcoolaiMono,
  Avatar: OcoolaiAvatar,
  colorPrimary: '#000000'
})
export default OcoolaiIcon
