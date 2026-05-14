import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GeminiAvatar } from './avatar'
import { GeminiDark } from './dark'
import { GeminiLight } from './light'

const Gemini = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GeminiLight {...props} className={className} />
  if (variant === 'dark') return <GeminiDark {...props} className={className} />
  return (
    <>
      <GeminiLight className={cn('dark:hidden', className)} {...props} />
      <GeminiDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const GeminiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Gemini, {
  Avatar: GeminiAvatar,
  colorPrimary: '#F6C013'
})

export default GeminiIcon
