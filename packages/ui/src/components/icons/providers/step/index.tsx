import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StepAvatar } from './avatar'
import { StepLight } from './light'

const Step = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StepLight {...props} className={className} />
  return <StepLight {...props} className={className} />
}

export const StepIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Step, {
  Avatar: StepAvatar,
  colorPrimary: '#000000'
})

export default StepIcon
