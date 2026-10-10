import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TopxaiAvatar } from './avatar'
import { TopxaiLight } from './light'

const Topxai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TopxaiLight {...props} className={className} />
  return <TopxaiLight {...props} className={className} />
}

export const TopxaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Topxai, {
  Avatar: TopxaiAvatar,
  colorPrimary: '#2458ef'
})

export default TopxaiIcon
