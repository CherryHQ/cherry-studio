import type { CompoundIcon, CompoundIconProps } from '../../types'
import { StepfunAvatar } from './avatar'
import { StepfunLight } from './light'

const Stepfun = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <StepfunLight {...props} className={className} />
  return <StepfunLight {...props} className={className} />
}

export const StepfunIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Stepfun, {
  Avatar: StepfunAvatar,
  colorPrimary: '#000000'
})

export default StepfunIcon
