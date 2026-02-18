import type { CompoundIcon } from '../../types'
import { TogetherAvatar } from './avatar'
import { Together } from './color'
import { TogetherMono } from './mono'

export const TogetherIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Together, {
  Color: Together,
  Mono: TogetherMono,
  Avatar: TogetherAvatar,
  colorPrimary: '#000000'
})
export default TogetherIcon
