import type { CompoundIcon, CompoundIconProps } from '../../types'
import { SakanaAvatar } from './avatar'
import { SakanaLight } from './light'

const Sakana = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <SakanaLight {...props} className={className} />
  return <SakanaLight {...props} className={className} />
}

export const SakanaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Sakana, {
  Avatar: SakanaAvatar,
  colorPrimary: '#000000'
})

export default SakanaIcon
