import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AiStudioAvatar } from './avatar'
import { AiStudioDark } from './dark'
import { AiStudioLight } from './light'

const AiStudio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AiStudioLight {...props} className={className} />
  if (variant === 'dark') return <AiStudioDark {...props} className={className} />
  return (
    <>
      <AiStudioLight className={cn('dark:hidden', className)} {...props} />
      <AiStudioDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AiStudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiStudio, {
  Avatar: AiStudioAvatar,
  colorPrimary: '#1A1A1A'
})

export default AiStudioIcon
