import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SiliconAvatar } from './avatar'
import { SiliconDark } from './dark'
import { SiliconLight } from './light'

const Silicon = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SiliconLight {...props} className={className} />
  if (variant === 'dark') return <SiliconDark {...props} className={className} />
  return (
    <>
      <SiliconLight className={cn('dark:hidden', className)} {...props} />
      <SiliconDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const SiliconIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Silicon, {
  Avatar: SiliconAvatar,
  colorPrimary: '#6E29F6'
})

export default SiliconIcon
