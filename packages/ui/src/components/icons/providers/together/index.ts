import type { CompoundIcon } from '../../types'
import { Together } from './color'
import { TogetherMono } from './mono'

export const TogetherIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Together, {
  Color: Together,
  Mono: TogetherMono,
  colorPrimary: '#000000'
})
export default TogetherIcon
