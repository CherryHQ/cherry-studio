import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokendosAvatar } from './avatar'
import { TokendosLight } from './light'

const Tokendos = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokendosLight {...props} className={className} />
  return <TokendosLight {...props} className={className} />
}

export const TokendosIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokendos, {
  Avatar: TokendosAvatar,
  colorPrimary: '#1e40af'
})

export default TokendosIcon
