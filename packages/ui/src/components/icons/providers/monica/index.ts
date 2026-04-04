import { type CompoundIcon } from '../../types'
import { MonicaAvatar } from './avatar'
import { Monica } from './color'
import { MonicaMono } from './mono'

export const MonicaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Monica, {
  Color: Monica,
  Mono: MonicaMono,
  Avatar: MonicaAvatar,
  colorPrimary: '#5057FA'
})

export default MonicaIcon
