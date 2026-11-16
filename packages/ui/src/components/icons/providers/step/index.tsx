import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StepAvatar } from './avatar'
import { StepDark } from './dark'
import { StepLight } from './light'

const Step = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StepLight {...props} className={className} />
  if (variant === 'dark') return <StepDark {...props} className={className} />
  return (
    <>
      <StepLight className={cn('dark:hidden', className)} {...props} />
      <StepDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const StepIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Step, {
  Avatar: StepAvatar,
  colorPrimary: '#000000'
})

export default StepIcon
