import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokenMarketAvatar } from './avatar'
import { TokenMarketDark } from './dark'
import { TokenMarketLight } from './light'

const TokenMarket = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokenMarketLight {...props} className={className} />
  if (variant === 'dark') return <TokenMarketDark {...props} className={className} />
  return (
    <>
      <TokenMarketLight className={cn('dark:hidden', className)} {...props} />
      <TokenMarketDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TokenMarketIcon: CompoundIcon = /*#__PURE__*/ Object.assign(TokenMarket, {
  Avatar: TokenMarketAvatar,
  colorPrimary: '#111111'
})

export default TokenMarketIcon
