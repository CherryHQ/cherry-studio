import { type CompoundIcon } from '../../types'
import { RecraftAvatar } from './avatar'
import { Recraft } from './color'
import { RecraftMono } from './mono'

export const RecraftIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Recraft, {
  Color: Recraft,
  Mono: RecraftMono,
  Avatar: RecraftAvatar,
  colorPrimary: '#010101'
})

export default RecraftIcon
