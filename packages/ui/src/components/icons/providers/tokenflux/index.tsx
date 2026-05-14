import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokenfluxAvatar } from './avatar'
import { TokenfluxLight } from './light'

const Tokenflux = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokenfluxLight {...props} className={className} />
  return <TokenfluxLight {...props} className={className} />
}

export const TokenfluxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokenflux, {
  Avatar: TokenfluxAvatar,
  colorPrimary: '#FEFEFE'
})

export default TokenfluxIcon
