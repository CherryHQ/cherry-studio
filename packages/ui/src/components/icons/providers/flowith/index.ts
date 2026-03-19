import { type CompoundIcon } from '../../types'
import { FlowithAvatar } from './avatar'
import { Flowith } from './color'
import { FlowithMono } from './mono'

export const FlowithIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Flowith, {
  Color: Flowith,
  Mono: FlowithMono,
  Avatar: FlowithAvatar,
  colorPrimary: '#000000'
})

export default FlowithIcon
