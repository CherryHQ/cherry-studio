import { type CompoundIcon } from '../../types'
import { SensetimeAvatar } from './avatar'
import { Sensetime } from './color'
import { SensetimeMono } from './mono'

export const SensetimeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensetime, {
  Color: Sensetime,
  Mono: SensetimeMono,
  Avatar: SensetimeAvatar,
  colorPrimary: '#7680F8'
})

export default SensetimeIcon
