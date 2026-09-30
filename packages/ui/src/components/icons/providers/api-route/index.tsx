import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ApiRouteAvatar } from './avatar'
import { ApiRouteLight } from './light'

const ApiRoute = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ApiRouteLight {...props} className={className} />
  return <ApiRouteLight {...props} className={className} />
}

export const ApiRouteIcon: CompoundIcon = /*#__PURE__*/ Object.assign(ApiRoute, {
  Avatar: ApiRouteAvatar,
  colorPrimary: '#000000'
})

export default ApiRouteIcon
