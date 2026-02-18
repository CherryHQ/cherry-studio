import { type CompoundIcon } from '../../types'
import { ModelscopeAvatar } from './avatar'
import { Modelscope } from './color'
import { ModelscopeMono } from './mono'

export const ModelscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Modelscope, {
  Color: Modelscope,
  Mono: ModelscopeMono,
  Avatar: ModelscopeAvatar,
  colorPrimary: '#624AFF'
})

export default ModelscopeIcon
