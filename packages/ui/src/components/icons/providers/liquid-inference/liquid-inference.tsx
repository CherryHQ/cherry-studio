import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LiquidInferenceAvatar } from './avatar'
import { LiquidInferenceLight } from './light'

const LiquidInference = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LiquidInferenceLight {...props} className={className} />
  return <LiquidInferenceLight {...props} className={className} />
}

export const LiquidInferenceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(LiquidInference, {
  Avatar: LiquidInferenceAvatar,
  colorPrimary: '#3c96dc'
})

export default LiquidInferenceIcon
