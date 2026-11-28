import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MartllmAvatar } from './avatar'
import { MartllmLight } from './light'

const Martllm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MartllmLight {...props} className={className} />
  return <MartllmLight {...props} className={className} />
}

export const MartllmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Martllm, {
  Avatar: MartllmAvatar,
  colorPrimary: '#0a0a0a'
})

export default MartllmIcon
