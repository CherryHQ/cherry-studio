import { type CompoundIcon } from '../../types'
import { ApplicationAvatar } from './avatar'
import { Application } from './color'
import { ApplicationMono } from './mono'

export const ApplicationIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Application, {
  Color: Application,
  Mono: ApplicationMono,
  Avatar: ApplicationAvatar,
  colorPrimary: '#2BA471'
})

export default ApplicationIcon
