import { type CompoundIcon } from '../../types'
import { DashscopeAvatar } from './avatar'
import { Dashscope } from './color'
import { DashscopeMono } from './mono'

export const DashscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dashscope, {
  Color: Dashscope,
  Mono: DashscopeMono,
  Avatar: DashscopeAvatar,
  colorPrimary: '#000000'
})

export default DashscopeIcon
