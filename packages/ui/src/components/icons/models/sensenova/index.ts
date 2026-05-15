import { type CompoundIcon } from '../../types'
import { SensenovaAvatar } from './avatar'
import { Sensenova } from './color'
import { SensenovaMono } from './mono'

export const SensenovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sensenova, {
  Color: Sensenova,
  Mono: SensenovaMono,
  Avatar: SensenovaAvatar,
  colorPrimary: '#01FFB9'
})

export default SensenovaIcon
