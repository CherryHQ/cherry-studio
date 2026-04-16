import { type CompoundIcon } from '../../types'
import { GensparkAvatar } from './avatar'
import { Genspark } from './color'
import { GensparkMono } from './mono'

export const GensparkIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Genspark, {
  Color: Genspark,
  Mono: GensparkMono,
  Avatar: GensparkAvatar,
  colorPrimary: '#000000'
})

export default GensparkIcon
