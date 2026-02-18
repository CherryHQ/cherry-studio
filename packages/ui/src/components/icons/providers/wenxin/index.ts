import type { CompoundIcon } from '../../types'
import { WenxinAvatar } from './avatar'
import { Wenxin } from './color'
import { WenxinMono } from './mono'

export const WenxinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Wenxin, {
  Color: Wenxin,
  Mono: WenxinMono,
  Avatar: WenxinAvatar,
  colorPrimary: '#012F8D'
})
export default WenxinIcon
