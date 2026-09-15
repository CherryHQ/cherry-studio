import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokenmarketAvatar } from './avatar'
import { TokenmarketDark } from './dark'
import { TokenmarketLight } from './light'

const Tokenmarket = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokenmarketLight {...props} className={className} />
  if (variant === 'dark') return <TokenmarketDark {...props} className={className} />
  return (
    <>
      <TokenmarketLight className={cn('dark:hidden', className)} {...props} />
      <TokenmarketDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TokenmarketIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokenmarket, {
  Avatar: TokenmarketAvatar,
  colorPrimary: '#111111'
})

export default TokenmarketIcon
