import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GlmAvatar } from './avatar'
import { GlmDark } from './dark'
import { GlmLight } from './light'

const Glm = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GlmLight {...props} className={className} />
  if (variant === 'dark') return <GlmDark {...props} className={className} />
  return (
    <>
      <GlmLight className={cn('dark:hidden', className)} {...props} />
      <GlmDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GlmIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glm, {
  Avatar: GlmAvatar,
  colorPrimary: '#5072E9'
})

export default GlmIcon
