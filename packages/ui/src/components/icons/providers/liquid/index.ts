import { type CompoundIcon } from '../../types'
import { LiquidAvatar } from './avatar'
import { Liquid } from './color'
import { LiquidMono } from './mono'

export const LiquidIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Liquid, {
  Color: Liquid,
  Mono: LiquidMono,
  Avatar: LiquidAvatar,
  colorPrimary: '#000000'
})

export default LiquidIcon
