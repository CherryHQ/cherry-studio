import type { CompoundIcon } from '../../types'
import { TngAvatar } from './avatar'
import { Tng } from './color'
import { TngMono } from './mono'

export const TngIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tng, {
  Color: Tng,
  Mono: TngMono,
  Avatar: TngAvatar,
  colorPrimary: '#FDFEFE'
})
export default TngIcon
