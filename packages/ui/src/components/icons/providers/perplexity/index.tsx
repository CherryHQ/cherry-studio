import type { SVGProps } from 'react'

import { cn } from '../../../../lib/utils'
import type { CompoundIcon } from '../../types'
import { PerplexityAvatar } from './avatar'
import { PerplexityDark } from './dark'
import { PerplexityLight } from './light'

const Perplexity = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <>
    <PerplexityLight className={cn('dark:hidden', className)} {...props} />
    <PerplexityDark className={cn('hidden dark:block', className)} {...props} />
  </>
)

export const PerplexityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Perplexity, {
  Light: PerplexityLight,
  Dark: PerplexityDark,
  Avatar: PerplexityAvatar,
  colorPrimary: '#20808D'
})

export default PerplexityIcon
