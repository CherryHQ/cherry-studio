import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokensmarketAvatar } from './avatar'
import { TokensmarketDark } from './dark'
import { TokensmarketLight } from './light'

const Tokensmarket = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokensmarketLight {...props} className={className} />
  if (variant === 'dark') return <TokensmarketDark {...props} className={className} />
  return (
    <>
      <TokensmarketLight className={cn('dark:hidden', className)} {...props} />
      <TokensmarketDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TokensmarketIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokensmarket, {
  Avatar: TokensmarketAvatar,
  colorPrimary: '#111111'
})

export default TokensmarketIcon
