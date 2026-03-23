import { type CompoundIcon } from '../../types'
import { PalmAvatar } from './avatar'
import { Palm } from './color'
import { PalmMono } from './mono'

export const PalmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Palm, {
  Color: Palm,
  Mono: PalmMono,
  Avatar: PalmAvatar,
  colorPrimary: '#FEFEFE'
})

export default PalmIcon
