import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GroqAvatar } from './avatar'
import { GroqDark } from './dark'
import { GroqLight } from './light'

const Groq = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GroqLight {...props} className={className} />
  if (variant === 'dark') return <GroqDark {...props} className={className} />
  return (
    <>
      <GroqLight className={cn('dark:hidden', className)} {...props} />
      <GroqDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GroqIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Groq, {
  Avatar: GroqAvatar,
  colorPrimary: '#F54F35'
})

export default GroqIcon
