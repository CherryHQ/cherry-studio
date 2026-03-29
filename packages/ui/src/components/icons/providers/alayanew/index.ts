import { type CompoundIcon } from '../../types'
import { AlayanewAvatar } from './avatar'
import { Alayanew } from './color'
import { AlayanewMono } from './mono'

export const AlayanewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Alayanew, {
  Color: Alayanew,
  Mono: AlayanewMono,
  Avatar: AlayanewAvatar,
  colorPrimary: '#4362FF'
})

export default AlayanewIcon
