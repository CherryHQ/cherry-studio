import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ParallelAvatar } from './avatar'
import { ParallelDark } from './dark'
import { ParallelLight } from './light'

const Parallel = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ParallelLight {...props} className={className} />
  if (variant === 'dark') return <ParallelDark {...props} className={className} />
  return (
    <>
      <ParallelLight className={cn('dark:hidden', className)} {...props} />
      <ParallelDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ParallelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Parallel, {
  Avatar: ParallelAvatar,
  colorPrimary: '#1D1C1A'
})

export default ParallelIcon
