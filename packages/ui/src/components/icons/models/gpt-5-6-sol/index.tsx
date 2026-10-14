import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt56SolAvatar } from './avatar'
import { Gpt56SolLight } from './light'

const Gpt56Sol = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt56SolLight {...props} className={className} />
  return <Gpt56SolLight {...props} className={className} />
}

export const Gpt56SolIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt56Sol, {
  Avatar: Gpt56SolAvatar,
  colorPrimary: '#000000'
})

export default Gpt56SolIcon
