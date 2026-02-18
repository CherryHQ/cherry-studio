import type { CompoundIcon } from '../../types'
import { QwenAvatar } from './avatar'
import { Qwen } from './color'
import { QwenMono } from './mono'

export const QwenIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Qwen, {
  Color: Qwen,
  Mono: QwenMono,
  Avatar: QwenAvatar,
  colorPrimary: '#615CED'
})
export default QwenIcon
