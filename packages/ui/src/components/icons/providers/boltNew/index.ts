import { type CompoundIcon } from '../../types'
import { BoltNewAvatar } from './avatar'
import { BoltNew } from './color'
import { BoltNewMono } from './mono'

export const BoltNewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(BoltNew, {
  Color: BoltNew,
  Mono: BoltNewMono,
  Avatar: BoltNewAvatar,
  colorPrimary: '#000000'
})

export default BoltNewIcon
