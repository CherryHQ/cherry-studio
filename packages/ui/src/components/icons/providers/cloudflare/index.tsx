import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CloudflareAvatar } from './avatar'
import { CloudflareDark } from './dark'
import { CloudflareLight } from './light'

const Cloudflare = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CloudflareLight {...props} className={className} />
  if (variant === 'dark') return <CloudflareDark {...props} className={className} />
  return (
    <>
      <CloudflareLight className={cn('dark:hidden', className)} {...props} />
      <CloudflareDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CloudflareIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Cloudflare, {
  Avatar: CloudflareAvatar,
  colorPrimary: '#F3811A'
})

export default CloudflareIcon
