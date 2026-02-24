import { type CompoundIcon } from '../../types'
import { VercelAvatar } from './avatar'
import { Vercel } from './color'
import { VercelMono } from './mono'

export const VercelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vercel, {
  Color: Vercel,
  Mono: VercelMono,
  Avatar: VercelAvatar,
  colorPrimary: '#000000'
})

export default VercelIcon
