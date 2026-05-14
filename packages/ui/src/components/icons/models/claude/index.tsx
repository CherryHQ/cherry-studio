import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ClaudeAvatar } from './avatar'
import { ClaudeDark } from './dark'
import { ClaudeLight } from './light'

const Claude = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ClaudeLight {...props} className={className} />
  if (variant === 'dark') return <ClaudeDark {...props} className={className} />
  return (
    <>
      <ClaudeLight className={cn('dark:hidden', className)} {...props} />
      <ClaudeDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const ClaudeIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Claude, {
  Avatar: ClaudeAvatar,
  colorPrimary: '#d97757'
})

export default ClaudeIcon
