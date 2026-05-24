import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InfiniAvatar } from './avatar'
import { InfiniLight } from './light'

const Infini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InfiniLight {...props} className={className} />
  return <InfiniLight {...props} className={className} />
}

export const InfiniIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Infini, {
  Avatar: InfiniAvatar,
  colorPrimary: '#6A3CFD'
})

export default InfiniIcon
