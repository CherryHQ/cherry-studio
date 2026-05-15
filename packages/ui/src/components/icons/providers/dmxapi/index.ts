import { type CompoundIcon } from '../../types'
import { DmxapiAvatar } from './avatar'
import { Dmxapi } from './color'
import { DmxapiMono } from './mono'

export const DmxapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dmxapi, {
  Color: Dmxapi,
  Mono: DmxapiMono,
  Avatar: DmxapiAvatar,
  colorPrimary: '#924C88'
})

export default DmxapiIcon
