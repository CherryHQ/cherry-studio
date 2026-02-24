import { type CompoundIcon } from '../../types'
import { Ai21Avatar } from './avatar'
import { Ai21 } from './color'
import { Ai21Mono } from './mono'

export const Ai21Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Ai21, {
  Color: Ai21,
  Mono: Ai21Mono,
  Avatar: Ai21Avatar,
  colorPrimary: '#000000'
})

export default Ai21Icon
