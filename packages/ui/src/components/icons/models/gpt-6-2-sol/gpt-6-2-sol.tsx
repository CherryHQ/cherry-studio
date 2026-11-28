import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt62SolAvatar } from './avatar'
import { Gpt62SolLight } from './light'

const Gpt62Sol = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt62SolLight {...props} className={className} />
  return <Gpt62SolLight {...props} className={className} />
}

export const Gpt62SolIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt62Sol, {
  Avatar: Gpt62SolAvatar,
  colorPrimary: '#090E1C'
})

export default Gpt62SolIcon
