import type { CompoundIcon } from '../../types'
import { GpustackAvatar } from './avatar'
import { Gpustack } from './color'
import { GpustackMono } from './mono'

export const GpustackIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpustack, {
  Color: Gpustack,
  Mono: GpustackMono,
  Avatar: GpustackAvatar,
  colorPrimary: '#000000'
})
export default GpustackIcon
