import type { CompoundIcon } from '../../types'
import { Gpt5Avatar } from './avatar'
import { Gpt5 } from './color'
import { Gpt5Mono } from './mono'

export const Gpt5Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5, {
  Color: Gpt5,
  Mono: Gpt5Mono,
  Avatar: Gpt5Avatar,
  colorPrimary: '#F6688E'
})
export default Gpt5Icon
