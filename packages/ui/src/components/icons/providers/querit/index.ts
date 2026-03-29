import { type CompoundIcon } from '../../types'
import { QueritAvatar } from './avatar'
import { Querit } from './color'
import { QueritMono } from './mono'

export const QueritIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Querit, {
  Color: Querit,
  Mono: QueritMono,
  Avatar: QueritAvatar,
  colorPrimary: '#4C8BF5'
})

export default QueritIcon
