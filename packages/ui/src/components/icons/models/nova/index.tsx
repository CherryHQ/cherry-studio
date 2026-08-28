import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NovaAvatar } from './avatar'
import { NovaLight } from './light'

const Nova = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NovaLight {...props} className={className} />
  return <NovaLight {...props} className={className} />
}

export const NovaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nova, {
  Avatar: NovaAvatar,
  colorPrimary: '#000000'
})

export default NovaIcon
