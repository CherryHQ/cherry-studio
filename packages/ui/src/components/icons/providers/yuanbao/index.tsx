import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YuanbaoAvatar } from './avatar'
import { YuanbaoLight } from './light'

const Yuanbao = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YuanbaoLight {...props} className={className} />
  return <YuanbaoLight {...props} className={className} />
}

export const YuanbaoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Yuanbao, {
  Avatar: YuanbaoAvatar,
  colorPrimary: '#38CF6F'
})

export default YuanbaoIcon
