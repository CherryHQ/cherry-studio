import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TingwuAvatar } from './avatar'
import { TingwuLight } from './light'

const Tingwu = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TingwuLight {...props} className={className} />
  return <TingwuLight {...props} className={className} />
}

export const TingwuIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tingwu, {
  Avatar: TingwuAvatar,
  colorPrimary: '#000000'
})

export default TingwuIcon
