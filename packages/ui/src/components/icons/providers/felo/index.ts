import { type CompoundIcon } from '../../types'
import { FeloAvatar } from './avatar'
import { Felo } from './color'
import { FeloMono } from './mono'

export const FeloIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Felo, {
  Color: Felo,
  Mono: FeloMono,
  Avatar: FeloAvatar,
  colorPrimary: '#24ABF7'
})

export default FeloIcon
