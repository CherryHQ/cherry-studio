import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SteadyRouterAvatar } from './avatar'
import { SteadyRouterLight } from './light'

const SteadyRouter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SteadyRouterLight {...props} className={className} />
  return <SteadyRouterLight {...props} className={className} />
}

export const SteadyRouterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(SteadyRouter, {
  Avatar: SteadyRouterAvatar,
  colorPrimary: '#0f766e'
})

export default SteadyRouterIcon
