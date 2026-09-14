import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt6AstraAvatar } from './avatar'
import { Gpt6AstraLight } from './light'

const Gpt6Astra = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt6AstraLight {...props} className={className} />
  return <Gpt6AstraLight {...props} className={className} />
}

export const Gpt6AstraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt6Astra, {
  Avatar: Gpt6AstraAvatar,
  colorPrimary: '#000000'
})

export default Gpt6AstraIcon
