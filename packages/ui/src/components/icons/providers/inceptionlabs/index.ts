import type { CompoundIcon } from '../../types'
import { InceptionlabsAvatar } from './avatar'
import { Inceptionlabs } from './color'
import { InceptionlabsMono } from './mono'

export const InceptionlabsIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inceptionlabs, {
  Color: Inceptionlabs,
  Mono: InceptionlabsMono,
  Avatar: InceptionlabsAvatar,
  colorPrimary: '#FDFDFD'
})
export default InceptionlabsIcon
