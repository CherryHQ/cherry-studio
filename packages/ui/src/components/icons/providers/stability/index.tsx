import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StabilityAvatar } from './avatar'
import { StabilityDark } from './dark'
import { StabilityLight } from './light'

const Stability = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StabilityLight {...props} className={className} />
  if (variant === 'dark') return <StabilityDark {...props} className={className} />
  return (
    <>
      <StabilityLight className={cn('dark:hidden', className)} {...props} />
      <StabilityDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const StabilityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Stability, {
  Avatar: StabilityAvatar,
  colorPrimary: '#E80000'
})

export default StabilityIcon
