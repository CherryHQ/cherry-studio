import type { CompoundIcon, CompoundIconProps } from '../../types'
import { EssentialAiAvatar } from './avatar'
import { EssentialAiLight } from './light'

const EssentialAi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <EssentialAiLight {...props} className={className} />
  return <EssentialAiLight {...props} className={className} />
}

export const EssentialAiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(EssentialAi, {
  Avatar: EssentialAiAvatar,
  colorPrimary: '#35058E'
})

export default EssentialAiIcon
