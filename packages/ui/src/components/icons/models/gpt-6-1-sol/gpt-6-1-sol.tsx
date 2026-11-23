import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt61SolAvatar } from './avatar'
import { Gpt61SolLight } from './light'

const Gpt61Sol = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt61SolLight {...props} className={className} />

  return <Gpt61SolLight {...props} className={className} />
}

export const Gpt61SolIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt61Sol, {
  Avatar: Gpt61SolAvatar,
  colorPrimary: '#060E14'
})

export default Gpt61SolIcon
