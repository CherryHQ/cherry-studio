import type { CompoundIcon, CompoundIconProps } from '../../types'
import { OpenrouterAvatar } from './avatar'
import { OpenrouterLight } from './light'

const Openrouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <OpenrouterLight {...props} className={className} />
  return <OpenrouterLight {...props} className={className} />
}

export const OpenrouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Openrouter, {
  Avatar: OpenrouterAvatar,
  colorPrimary: '#C8FF00'
})

export default OpenrouterIcon
