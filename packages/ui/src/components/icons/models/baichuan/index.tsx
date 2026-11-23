import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaichuanAvatar } from './avatar'
import { BaichuanLight } from './light'

const Baichuan = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaichuanLight {...props} className={className} />

  return <BaichuanLight {...props} className={className} />
}

export const BaichuanIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baichuan, {
  Avatar: BaichuanAvatar,
  colorPrimary: '#FFF3E4'
})

export default BaichuanIcon
