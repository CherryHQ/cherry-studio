import type { CompoundIcon, CompoundIconProps } from '../../types'
import { KwaipilotAvatar } from './avatar'
import { KwaipilotLight } from './light'

const Kwaipilot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <KwaipilotLight {...props} className={className} />
  return <KwaipilotLight {...props} className={className} />
}

export const KwaipilotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Kwaipilot, {
  Avatar: KwaipilotAvatar,
  colorPrimary: '#000000'
})

export default KwaipilotIcon
