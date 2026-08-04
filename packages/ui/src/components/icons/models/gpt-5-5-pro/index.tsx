import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt55ProAvatar } from './avatar'
import { Gpt55ProLight } from './light'

const Gpt55Pro = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt55ProLight {...props} className={className} />
  return <Gpt55ProLight {...props} className={className} />
}

export const Gpt55ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt55Pro, {
  Avatar: Gpt55ProAvatar,
  colorPrimary: '#000000'
})

export default Gpt55ProIcon
