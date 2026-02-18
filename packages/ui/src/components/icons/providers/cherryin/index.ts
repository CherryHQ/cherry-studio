import type { CompoundIcon } from '../../types'
import { CherryinAvatar } from './avatar'
import { Cherryin } from './color'
import { CherryinMono } from './mono'

export const CherryinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cherryin, {
  Color: Cherryin,
  Mono: CherryinMono,
  Avatar: CherryinAvatar,
  colorPrimary: '#FF5F5F'
})
export default CherryinIcon
