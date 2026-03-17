import { type CompoundIcon } from '../../types'
import { DifyAvatar } from './avatar'
import { Dify } from './color'
import { DifyMono } from './mono'

export const DifyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dify, {
  Color: Dify,
  Mono: DifyMono,
  Avatar: DifyAvatar,
  colorPrimary: '#FDFEFF'
})

export default DifyIcon
