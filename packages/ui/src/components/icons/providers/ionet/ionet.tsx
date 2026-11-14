import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IonetAvatar } from './avatar'
import { IonetDark } from './dark'
import { IonetLight } from './light'

const Ionet = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IonetLight {...props} className={className} />
  if (variant === 'dark') return <IonetDark {...props} className={className} />
  return (
    <>
      <IonetLight className={cn('dark:hidden', className)} {...props} />
      <IonetDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const IonetIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ionet, {
  Avatar: IonetAvatar,
  colorPrimary: '#000000'
})

export default IonetIcon
