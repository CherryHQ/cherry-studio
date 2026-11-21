import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HostlinkuAvatar } from './avatar'
import { HostlinkuDark } from './dark'
import { HostlinkuLight } from './light'

const Hostlinku = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HostlinkuLight {...props} className={className} />
  if (variant === 'dark') return <HostlinkuDark {...props} className={className} />
  return (
    <>
      <HostlinkuLight className={cn('dark:hidden', className)} {...props} />
      <HostlinkuDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const HostlinkuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hostlinku, {
  Avatar: HostlinkuAvatar,
  colorPrimary: '#000000'
})

export default HostlinkuIcon
