import { type CompoundIcon } from '../../types'
import { ImaAvatar } from './avatar'
import { Ima } from './color'
import { ImaMono } from './mono'

export const ImaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ima, {
  Color: Ima,
  Mono: ImaMono,
  Avatar: ImaAvatar,
  colorPrimary: '#4DEE9E'
})

export default ImaIcon
