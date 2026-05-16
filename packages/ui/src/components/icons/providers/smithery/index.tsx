import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SmitheryAvatar } from './avatar'
import { SmitheryLight } from './light'

const Smithery = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SmitheryLight {...props} className={className} />
  return <SmitheryLight {...props} className={className} />
}

export const SmitheryIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Smithery, {
  Avatar: SmitheryAvatar,
  colorPrimary: '#FF5601'
})

export default SmitheryIcon
