import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AcctokenAvatar } from './avatar'
import { AcctokenLight } from './light'

const Acctoken = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AcctokenLight {...props} className={className} />
  return <AcctokenLight {...props} className={className} />
}

export const AcctokenIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Acctoken, {
  Avatar: AcctokenAvatar,
  colorPrimary: '#111111'
})

export default AcctokenIcon
