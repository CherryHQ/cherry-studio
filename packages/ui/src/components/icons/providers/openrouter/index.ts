import { type CompoundIcon } from '../../types'
import { OpenrouterAvatar } from './avatar'
import { Openrouter } from './color'
import { OpenrouterMono } from './mono'

export const OpenrouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openrouter, {
  Color: Openrouter,
  Mono: OpenrouterMono,
  Avatar: OpenrouterAvatar,
  colorPrimary: '#000000'
})

export default OpenrouterIcon
