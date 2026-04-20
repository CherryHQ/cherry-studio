import { type CompoundIcon } from '../../types'
import { LingxiAvatar } from './avatar'
import { Lingxi } from './color'
import { LingxiMono } from './mono'

export const LingxiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lingxi, {
  Color: Lingxi,
  Mono: LingxiMono,
  Avatar: LingxiAvatar,
  colorPrimary: '#000000'
})

export default LingxiIcon
