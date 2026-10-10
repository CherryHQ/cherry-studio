import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TencentAvatar } from './avatar'
import { TencentLight } from './light'

const Tencent = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TencentLight {...props} className={className} />
  return <TencentLight {...props} className={className} />
}

export const TencentIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tencent, {
  Avatar: TencentAvatar,
  colorPrimary: '#0052D9'
})

export default TencentIcon
