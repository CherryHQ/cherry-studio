import { type CompoundIcon } from '../../types'
import { ZhidaAvatar } from './avatar'
import { Zhida } from './color'
import { ZhidaMono } from './mono'

export const ZhidaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Zhida, {
  Color: Zhida,
  Mono: ZhidaMono,
  Avatar: ZhidaAvatar,
  colorPrimary: '#6F5BFE'
})

export default ZhidaIcon
