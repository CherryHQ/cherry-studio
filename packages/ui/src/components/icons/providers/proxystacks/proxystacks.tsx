import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ProxystacksAvatar } from './avatar'
import { ProxystacksDark } from './dark'
import { ProxystacksLight } from './light'

const Proxystacks = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ProxystacksLight {...props} className={className} />
  if (variant === 'dark') return <ProxystacksDark {...props} className={className} />
  return (
    <>
      <ProxystacksLight className={cn('dark:hidden', className)} {...props} />
      <ProxystacksDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ProxystacksIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Proxystacks, {
  Avatar: ProxystacksAvatar,
  colorPrimary: '#0A0A0A'
})

export default ProxystacksIcon
