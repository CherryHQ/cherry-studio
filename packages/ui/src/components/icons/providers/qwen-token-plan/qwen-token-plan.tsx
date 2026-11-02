import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QwenTokenPlanAvatar } from './avatar'
import { QwenTokenPlanLight } from './light'

const QwenTokenPlan = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QwenTokenPlanLight {...props} className={className} />
  return <QwenTokenPlanLight {...props} className={className} />
}

export const QwenTokenPlanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(QwenTokenPlan, {
  Avatar: QwenTokenPlanAvatar,
  colorPrimary: '#000000'
})

export default QwenTokenPlanIcon
