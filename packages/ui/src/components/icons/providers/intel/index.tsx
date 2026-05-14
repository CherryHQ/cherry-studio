import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IntelAvatar } from './avatar'
import { IntelDark } from './dark'
import { IntelLight } from './light'

const Intel = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IntelLight {...props} className={className} />
  if (variant === 'dark') return <IntelDark {...props} className={className} />
  return (
    <>
      <IntelLight className={cn('dark:hidden', className)} {...props} />
      <IntelDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const IntelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Intel, {
  Avatar: IntelAvatar,
  colorPrimary: '#0071C5'
})

export default IntelIcon
