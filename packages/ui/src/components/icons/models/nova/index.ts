import { type CompoundIcon } from '../../types'
import { NovaAvatar } from './avatar'
import { Nova } from './color'
import { NovaMono } from './mono'

export const NovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nova, {
  Color: Nova,
  Mono: NovaMono,
  Avatar: NovaAvatar,
  colorPrimary: '#FF6200'
})

export default NovaIcon
