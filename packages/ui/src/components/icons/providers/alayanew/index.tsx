import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AlayanewAvatar } from './avatar'
import { AlayanewLight } from './light'

const Alayanew = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AlayanewLight {...props} className={className} />
  return <AlayanewLight {...props} className={className} />
}

export const AlayanewIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Alayanew, {
  Avatar: AlayanewAvatar,
  colorPrimary: '#4362FF'
})

export default AlayanewIcon
