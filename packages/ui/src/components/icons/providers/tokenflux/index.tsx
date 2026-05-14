import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TokenfluxAvatar } from './avatar'
import { TokenfluxDark } from './dark'
import { TokenfluxLight } from './light'

const Tokenflux = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TokenfluxLight {...props} className={className} />
  if (variant === 'dark') return <TokenfluxDark {...props} className={className} />
  return (
    <>
      <TokenfluxLight className={cn('dark:hidden', className)} {...props} />
      <TokenfluxDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TokenfluxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokenflux, {
  Avatar: TokenfluxAvatar,
  colorPrimary: '#FEFEFE'
})

export default TokenfluxIcon
