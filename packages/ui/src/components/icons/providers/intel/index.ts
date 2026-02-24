import { type CompoundIcon } from '../../types'
import { IntelAvatar } from './avatar'
import { Intel } from './color'
import { IntelMono } from './mono'

export const IntelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Intel, {
  Color: Intel,
  Mono: IntelMono,
  Avatar: IntelAvatar,
  colorPrimary: '#000000'
})

export default IntelIcon
