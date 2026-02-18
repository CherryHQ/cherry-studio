import type { CompoundIcon } from '../../types'
import { Gpt51Avatar } from './avatar'
import { Gpt51 } from './color'
import { Gpt51Mono } from './mono'

export const Gpt51Icon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt51, {
  Color: Gpt51,
  Mono: Gpt51Mono,
  Avatar: Gpt51Avatar,
  colorPrimary: '#ECCFE2'
})
export default Gpt51Icon
