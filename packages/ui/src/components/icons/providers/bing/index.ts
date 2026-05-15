import { type CompoundIcon } from '../../types'
import { BingAvatar } from './avatar'
import { Bing } from './color'
import { BingMono } from './mono'

export const BingIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bing, {
  Color: Bing,
  Mono: BingMono,
  Avatar: BingAvatar,
  colorPrimary: '#000000'
})

export default BingIcon
