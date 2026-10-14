import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt5ProAvatar } from './avatar'
import { Gpt5ProLight } from './light'

const Gpt5Pro = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt5ProLight {...props} className={className} />
  return <Gpt5ProLight {...props} className={className} />
}

export const Gpt5ProIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt5Pro, {
  Avatar: Gpt5ProAvatar,
  colorPrimary: '#000000'
})

export default Gpt5ProIcon
