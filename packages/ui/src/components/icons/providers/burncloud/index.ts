import { type CompoundIcon } from '../../types'
import { BurncloudAvatar } from './avatar'
import { Burncloud } from './color'
import { BurncloudMono } from './mono'

export const BurncloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Burncloud, {
  Color: Burncloud,
  Mono: BurncloudMono,
  Avatar: BurncloudAvatar,
  colorPrimary: '#EE7C1D'
})

export default BurncloudIcon
