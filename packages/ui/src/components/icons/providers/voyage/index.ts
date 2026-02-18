import type { CompoundIcon } from '../../types'
import { VoyageAvatar } from './avatar'
import { Voyage } from './color'
import { VoyageMono } from './mono'

export const VoyageIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Voyage, {
  Color: Voyage,
  Mono: VoyageMono,
  Avatar: VoyageAvatar,
  colorPrimary: '#333333'
})
export default VoyageIcon
