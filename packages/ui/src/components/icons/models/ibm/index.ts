import type { CompoundIcon } from '../../types'
import { IbmAvatar } from './avatar'
import { Ibm } from './color'
import { IbmMono } from './mono'

export const IbmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ibm, {
  Color: Ibm,
  Mono: IbmMono,
  Avatar: IbmAvatar,
  colorPrimary: '#1D67AC'
})
export default IbmIcon
