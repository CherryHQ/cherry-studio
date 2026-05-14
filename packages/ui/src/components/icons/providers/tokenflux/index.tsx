import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { TokenfluxAvatar } from './avatar'
import { TokenfluxDark } from './dark'
import { TokenfluxLight } from './light'

const Tokenflux = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <TokenfluxLight className={cn('dark:hidden', className)} {...props} />
    <TokenfluxDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const TokenfluxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Tokenflux, {
  Light: TokenfluxLight,
  Dark: TokenfluxDark,
  Avatar: TokenfluxAvatar,
  colorPrimary: '#FEFEFE'
})

export default TokenfluxIcon
