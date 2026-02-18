import type { CompoundIcon } from '../../types'
import { Gpt5NanoAvatar } from './avatar'
import { Gpt5Nano } from './color'
import { Gpt5NanoMono } from './mono'

export const Gpt5NanoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Nano, {
  Color: Gpt5Nano,
  Mono: Gpt5NanoMono,
  Avatar: Gpt5NanoAvatar,
  colorPrimary: '#9E9DF1'
})
export default Gpt5NanoIcon
