import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { CloudflareAvatar } from './avatar'
import { CloudflareDark } from './dark'
import { CloudflareLight } from './light'

const Cloudflare = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <CloudflareLight className={cn('dark:hidden', className)} {...props} />
    <CloudflareDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const CloudflareIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cloudflare, {
  Light: CloudflareLight,
  Dark: CloudflareDark,
  Avatar: CloudflareAvatar,
  colorPrimary: '#F3811A'
})

export default CloudflareIcon
