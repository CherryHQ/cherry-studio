import { type CompoundIcon } from '../../types'
import { NvidiaAvatar } from './avatar'
import { Nvidia } from './color'
import { NvidiaMono } from './mono'

export const NvidiaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nvidia, {
  Color: Nvidia,
  Mono: NvidiaMono,
  Avatar: NvidiaAvatar,
  colorPrimary: '#76B900'
})

export default NvidiaIcon
