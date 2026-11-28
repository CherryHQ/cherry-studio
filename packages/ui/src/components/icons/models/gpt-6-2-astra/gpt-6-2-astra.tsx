import type { CompoundIcon, CompoundIconProps } from '../../types'
import { Gpt62AstraAvatar } from './avatar'
import { Gpt62AstraLight } from './light'

const Gpt62Astra = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <Gpt62AstraLight {...props} className={className} />
  return <Gpt62AstraLight {...props} className={className} />
}

export const Gpt62AstraIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gpt62Astra, {
  Avatar: Gpt62AstraAvatar,
  colorPrimary: '#080E1F'
})

export default Gpt62AstraIcon
