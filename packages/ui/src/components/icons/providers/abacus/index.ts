import { type CompoundIcon } from '../../types'
import { AbacusAvatar } from './avatar'
import { Abacus } from './color'
import { AbacusMono } from './mono'

export const AbacusIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Abacus, {
  Color: Abacus,
  Mono: AbacusMono,
  Avatar: AbacusAvatar,
  colorPrimary: '#D7E5F0'
})

export default AbacusIcon
