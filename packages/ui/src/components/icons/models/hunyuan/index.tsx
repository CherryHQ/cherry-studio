import type { CompoundIcon, CompoundIconProps } from '../../types'
import { HunyuanAvatar } from './avatar'
import { HunyuanLight } from './light'

const Hunyuan = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <HunyuanLight {...props} className={className} />
  return <HunyuanLight {...props} className={className} />
}

export const HunyuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Hunyuan, {
  Avatar: HunyuanAvatar,
  colorPrimary: '#0054E0'
})

export default HunyuanIcon
