import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SophnetAvatar } from './avatar'
import { SophnetDark } from './dark'
import { SophnetLight } from './light'

const Sophnet = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SophnetLight {...props} className={className} />
  if (variant === 'dark') return <SophnetDark {...props} className={className} />
  return (
    <>
      <SophnetLight className={cn('dark:hidden', className)} {...props} />
      <SophnetDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SophnetIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sophnet, {
  Avatar: SophnetAvatar,
  colorPrimary: '#6200EE'
})

export default SophnetIcon
