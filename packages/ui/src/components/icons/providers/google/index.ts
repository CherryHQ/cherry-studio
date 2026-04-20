import { type CompoundIcon } from '../../types'
import { GoogleAvatar } from './avatar'
import { Google } from './color'
import { GoogleMono } from './mono'

export const GoogleIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Google, {
  Color: Google,
  Mono: GoogleMono,
  Avatar: GoogleAvatar,
  colorPrimary: '#3086FF'
})

export default GoogleIcon
