import type { CompoundIcon, CompoundIconProps } from '../../types'
import { UdioAvatar } from './avatar'
import { UdioLight } from './light'

const Udio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <UdioLight {...props} className={className} />
  return <UdioLight {...props} className={className} />
}

export const UdioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Udio, {
  Avatar: UdioAvatar,
  colorPrimary: '#E30A5D'
})

export default UdioIcon
