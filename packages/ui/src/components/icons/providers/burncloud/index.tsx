import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BurncloudAvatar } from './avatar'
import { BurncloudLight } from './light'

const Burncloud = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BurncloudLight {...props} className={className} />
  return <BurncloudLight {...props} className={className} />
}

export const BurncloudIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Burncloud, {
  Avatar: BurncloudAvatar,
  colorPrimary: '#000000'
})

export default BurncloudIcon
