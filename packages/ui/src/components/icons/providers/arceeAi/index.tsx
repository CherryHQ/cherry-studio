import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ArceeAiAvatar } from './avatar'
import { ArceeAiLight } from './light'

const ArceeAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ArceeAiLight {...props} className={className} />
  return <ArceeAiLight {...props} className={className} />
}

export const ArceeAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ArceeAi, {
  Avatar: ArceeAiAvatar,
  colorPrimary: '#008C8C'
})

export default ArceeAiIcon
