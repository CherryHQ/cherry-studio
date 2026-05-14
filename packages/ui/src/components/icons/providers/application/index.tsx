import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ApplicationAvatar } from './avatar'
import { ApplicationLight } from './light'

const Application = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ApplicationLight {...props} className={className} />
  return <ApplicationLight {...props} className={className} />
}

export const ApplicationIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Application, {
  Avatar: ApplicationAvatar,
  colorPrimary: '#2BA471'
})

export default ApplicationIcon
