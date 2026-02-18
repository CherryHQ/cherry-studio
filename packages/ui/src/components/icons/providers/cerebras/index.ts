import type { CompoundIcon } from '../../types'
import { CerebrasAvatar } from './avatar'
import { Cerebras } from './color'
import { CerebrasMono } from './mono'

export const CerebrasIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cerebras, {
  Color: Cerebras,
  Mono: CerebrasMono,
  Avatar: CerebrasAvatar,
  colorPrimary: '#F05A28'
})
export default CerebrasIcon
