import type { CompoundIcon, CompoundIconProps } from '../../types'
import { QueritAvatar } from './avatar'
import { QueritLight } from './light'

const Querit = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <QueritLight {...props} className={className} />
  return <QueritLight {...props} className={className} />
}

export const QueritIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Querit, {
  Avatar: QueritAvatar,
  colorPrimary: '#0056F5'
})

export default QueritIcon
