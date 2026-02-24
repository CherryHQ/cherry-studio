import { type CompoundIcon } from '../../types'
import { CozeAvatar } from './avatar'
import { Coze } from './color'
import { CozeMono } from './mono'

export const CozeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Coze, {
  Color: Coze,
  Mono: CozeMono,
  Avatar: CozeAvatar,
  colorPrimary: '#000000'
})

export default CozeIcon
