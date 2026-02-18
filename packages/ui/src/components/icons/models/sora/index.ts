import type { CompoundIcon } from '../../types'
import { SoraAvatar } from './avatar'
import { Sora } from './color'
import { SoraMono } from './mono'

export const SoraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sora, {
  Color: Sora,
  Mono: SoraMono,
  Avatar: SoraAvatar,
  colorPrimary: '#012659'
})
export default SoraIcon
