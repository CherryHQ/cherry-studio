import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt4oAvatar } from './avatar'
import { Gpt4oLight } from './light'

const Gpt4o = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt4oLight {...props} className={className} />
  return <Gpt4oLight {...props} className={className} />
}

export const Gpt4oIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt4o, {
  Avatar: Gpt4oAvatar,
  colorPrimary: '#000000'
})

export default Gpt4oIcon
