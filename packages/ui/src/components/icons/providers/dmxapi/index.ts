import type { CompoundIcon } from '../../types'
import { Dmxapi } from './color'
import { DmxapiMono } from './mono'

export const DmxapiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dmxapi, {
  Color: Dmxapi,
  Mono: DmxapiMono,
  colorPrimary: '#924C88'
})
export default DmxapiIcon
