import { type CompoundIcon } from '../../types'
import { DoubaoAvatar } from './avatar'
import { Doubao } from './color'
import { DoubaoMono } from './mono'

export const DoubaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Doubao, {
  Color: Doubao,
  Mono: DoubaoMono,
  Avatar: DoubaoAvatar,
  colorPrimary: '#1E37FC'
})

export default DoubaoIcon
