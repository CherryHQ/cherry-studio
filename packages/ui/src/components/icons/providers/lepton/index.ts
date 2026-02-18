import type { CompoundIcon } from '../../types'
import { LeptonAvatar } from './avatar'
import { Lepton } from './color'
import { LeptonMono } from './mono'

export const LeptonIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lepton, {
  Color: Lepton,
  Mono: LeptonMono,
  Avatar: LeptonAvatar,
  colorPrimary: '#2D9CDB'
})
export default LeptonIcon
