import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YouAvatar } from './avatar'
import { YouDark } from './dark'
import { YouLight } from './light'

const You = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YouLight {...props} className={className} />
  if (variant === 'dark') return <YouDark {...props} className={className} />
  return (
    <>
      <YouLight className={cn('dark:hidden', className)} {...props} />
      <YouDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const YouIcon: CompoundIcon = /*#__PURE__*/ Object.assign(You, {
  Avatar: YouAvatar,
  colorPrimary: '#000000'
})

export default YouIcon
