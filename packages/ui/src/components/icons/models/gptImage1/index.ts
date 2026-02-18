import type { CompoundIcon } from '../../types'
import { GptImage1Avatar } from './avatar'
import { GptImage1 } from './color'
import { GptImage1Mono } from './mono'

export const GptImage1Icon: CompoundIcon = /*#__PURE__*/ Object.assign(GptImage1, {
  Color: GptImage1,
  Mono: GptImage1Mono,
  Avatar: GptImage1Avatar,
  colorPrimary: '#73C8E2'
})
export default GptImage1Icon
