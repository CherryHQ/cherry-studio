import { type CompoundIcon } from '../../types'
import { CloudflareAvatar } from './avatar'
import { Cloudflare } from './color'
import { CloudflareMono } from './mono'

export const CloudflareIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cloudflare, {
  Color: Cloudflare,
  Mono: CloudflareMono,
  Avatar: CloudflareAvatar,
  colorPrimary: '#F3811A'
})

export default CloudflareIcon
