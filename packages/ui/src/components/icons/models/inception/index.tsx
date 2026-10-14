import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InceptionAvatar } from './avatar'
import { InceptionDark } from './dark'
import { InceptionLight } from './light'

const Inception = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InceptionLight {...props} className={className} />
  if (variant === 'dark') return <InceptionDark {...props} className={className} />
  return (
    <>
      <InceptionLight className={cn('dark:hidden', className)} {...props} />
      <InceptionDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const InceptionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inception, {
  Avatar: InceptionAvatar,
  colorPrimary: '#000000'
})

export default InceptionIcon
