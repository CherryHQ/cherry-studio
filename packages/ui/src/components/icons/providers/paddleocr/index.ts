import type { CompoundIcon } from '../../types'
import { PaddleocrAvatar } from './avatar'
import { Paddleocr } from './color'
import { PaddleocrMono } from './mono'

export const PaddleocrIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Paddleocr, {
  Color: Paddleocr,
  Mono: PaddleocrMono,
  Avatar: PaddleocrAvatar,
  colorPrimary: '#363FE5'
})
export default PaddleocrIcon
