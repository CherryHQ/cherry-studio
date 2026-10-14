import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GrokAvatar } from './avatar'
import { GrokDark } from './dark'
import { GrokLight } from './light'

const Grok = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GrokLight {...props} className={className} />
  if (variant === 'dark') return <GrokDark {...props} className={className} />
  return (
    <>
      <GrokLight className={cn('dark:hidden', className)} {...props} />
      <GrokDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GrokIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Grok, {
  Avatar: GrokAvatar,
  colorPrimary: '#000000'
})

export default GrokIcon
