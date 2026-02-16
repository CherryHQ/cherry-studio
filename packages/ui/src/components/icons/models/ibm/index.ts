import type { CompoundIcon } from '../../types'
import { Ibm } from './color'
import { IbmMono } from './mono'

export const IbmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ibm, {
  Color: Ibm,
  Mono: IbmMono,
  colorPrimary: '#DFE9F3'
})
export default IbmIcon
