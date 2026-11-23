import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RequestyAvatar } from './avatar'
import { RequestyLight } from './light'

const Requesty = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RequestyLight {...props} className={className} />
  return <RequestyLight {...props} className={className} />
}

export const RequestyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Requesty, {
  Avatar: RequestyAvatar,
  colorPrimary: '#334155'
})

export default RequestyIcon
