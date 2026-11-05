import type { CompoundIcon, CompoundIconProps } from '../../types'
import { UberllmAvatar } from './avatar'
import { UberllmLight } from './light'

const Uberllm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <UberllmLight {...props} className={className} />
  return <UberllmLight {...props} className={className} />
}

export const UberllmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Uberllm, {
  Avatar: UberllmAvatar,
  colorPrimary: '#5B4EE6'
})

export default UberllmIcon
