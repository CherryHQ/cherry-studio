import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CloudflareAvatar } from './avatar'
import { CloudflareLight } from './light'

const Cloudflare = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CloudflareLight {...props} className={className} />
  return <CloudflareLight {...props} className={className} />
}

export const CloudflareIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cloudflare, {
  Avatar: CloudflareAvatar,
  colorPrimary: '#F3811A'
})

export default CloudflareIcon
