import { type CompoundIcon } from '../../types'
import { SkyworkAvatar } from './avatar'
import { Skywork } from './color'
import { SkyworkMono } from './mono'

export const SkyworkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Skywork, {
  Color: Skywork,
  Mono: SkyworkMono,
  Avatar: SkyworkAvatar,
  colorPrimary: '#4D5EFF'
})

export default SkyworkIcon
