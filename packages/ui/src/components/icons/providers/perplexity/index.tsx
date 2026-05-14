import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PerplexityAvatar } from './avatar'
import { PerplexityDark } from './dark'
import { PerplexityLight } from './light'

const Perplexity = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PerplexityLight {...props} className={className} />
  if (variant === 'dark') return <PerplexityDark {...props} className={className} />
  return (
    <>
      <PerplexityLight className={cn('dark:hidden', className)} {...props} />
      <PerplexityDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const PerplexityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Perplexity, {
  Avatar: PerplexityAvatar,
  colorPrimary: '#20808D'
})

export default PerplexityIcon
