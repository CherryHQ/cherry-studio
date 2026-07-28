import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GoogleAvatar } from './avatar'
import { GoogleLight } from './light'

const Google = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GoogleLight {...props} className={className} />
  return <GoogleLight {...props} className={className} />
}

export const GoogleIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Google, {
  Avatar: GoogleAvatar,
  colorPrimary: '#3086FF'
})

export default GoogleIcon
