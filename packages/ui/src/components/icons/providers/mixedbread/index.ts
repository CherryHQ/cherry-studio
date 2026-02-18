import { type CompoundIcon } from '../../types'
import { MixedbreadAvatar } from './avatar'
import { Mixedbread } from './color'
import { MixedbreadMono } from './mono'

export const MixedbreadIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Mixedbread, {
  Color: Mixedbread,
  Mono: MixedbreadMono,
  Avatar: MixedbreadAvatar,
  colorPrimary: '#EC6168'
})

export default MixedbreadIcon
