import { type CompoundIcon } from '../../types'
import { Gpt52ProAvatar } from './avatar'
import { Gpt52Pro } from './color'
import { Gpt52ProMono } from './mono'

export const Gpt52ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt52Pro, {
  Color: Gpt52Pro,
  Mono: Gpt52ProMono,
  Avatar: Gpt52ProAvatar,
  colorPrimary: '#D998D8'
})

export default Gpt52ProIcon
