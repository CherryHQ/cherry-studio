import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { CommonstackAvatar } from './avatar'
import { CommonstackDark } from './dark'
import { CommonstackLight } from './light'

const Commonstack = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <CommonstackLight {...props} className={className} />
  if (variant === 'dark') return <CommonstackDark {...props} className={className} />
  return (
    <>
      <CommonstackLight className={cn('dark:hidden', className)} {...props} />
      <CommonstackDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const CommonstackIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Commonstack, {
  Avatar: CommonstackAvatar,
  colorPrimary: '#1A1A71'
})

export default CommonstackIcon
