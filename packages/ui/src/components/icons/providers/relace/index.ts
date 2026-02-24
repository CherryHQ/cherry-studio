import { type CompoundIcon } from '../../types'
import { RelaceAvatar } from './avatar'
import { Relace } from './color'
import { RelaceMono } from './mono'

export const RelaceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Relace, {
  Color: Relace,
  Mono: RelaceMono,
  Avatar: RelaceAvatar,
  colorPrimary: '#020202'
})

export default RelaceIcon
