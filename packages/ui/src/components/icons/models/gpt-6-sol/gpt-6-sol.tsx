import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt6SolAvatar } from './avatar'
import { Gpt6SolLight } from './light'

const Gpt6Sol = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt6SolLight {...props} className={className} />

  return <Gpt6SolLight {...props} className={className} />
}

export const Gpt6SolIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt6Sol, {
  Avatar: Gpt6SolAvatar,
  colorPrimary: '#050201'
})

export default Gpt6SolIcon
