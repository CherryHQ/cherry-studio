import { type CompoundIcon } from '../../types'
import { YuanbaoAvatar } from './avatar'
import { Yuanbao } from './color'
import { YuanbaoMono } from './mono'

export const YuanbaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Yuanbao, {
  Color: Yuanbao,
  Mono: YuanbaoMono,
  Avatar: YuanbaoAvatar,
  colorPrimary: '#4CC97A'
})

export default YuanbaoIcon
