import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DashscopeAvatar } from './avatar'
import { DashscopeLight } from './light'

const Dashscope = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DashscopeLight {...props} className={className} />
  return <DashscopeLight {...props} className={className} />
}

export const DashscopeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dashscope, {
  Avatar: DashscopeAvatar,
  colorPrimary: '#000000'
})

export default DashscopeIcon
