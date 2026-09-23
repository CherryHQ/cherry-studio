import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokendanceAvatar } from './avatar'
import { TokendanceLight } from './light'

const Tokendance = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokendanceLight {...props} className={className} />
  return <TokendanceLight {...props} className={className} />
}

export const TokendanceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokendance, {
  Avatar: TokendanceAvatar,
  colorPrimary: '#000000'
})

export default TokendanceIcon
