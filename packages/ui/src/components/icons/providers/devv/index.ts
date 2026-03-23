import { type CompoundIcon } from '../../types'
import { DevvAvatar } from './avatar'
import { Devv } from './color'
import { DevvMono } from './mono'

export const DevvIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Devv, {
  Color: Devv,
  Mono: DevvMono,
  Avatar: DevvAvatar,
  colorPrimary: '#101828'
})

export default DevvIcon
