import { type CompoundIcon } from '../../types'
import { StablilityAvatar } from './avatar'
import { Stablility } from './color'
import { StablilityMono } from './mono'

export const StablilityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Stablility, {
  Color: Stablility,
  Mono: StablilityMono,
  Avatar: StablilityAvatar,
  colorPrimary: '#000000'
})

export default StablilityIcon
