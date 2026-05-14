import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AiOnlyAvatar } from './avatar'
import { AiOnlyDark } from './dark'
import { AiOnlyLight } from './light'

const AiOnly = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AiOnlyLight {...props} className={className} />
  if (variant === 'dark') return <AiOnlyDark {...props} className={className} />
  return (
    <>
      <AiOnlyLight className={cn('dark:hidden', className)} {...props} />
      <AiOnlyDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const AiOnlyIcon: CompoundIcon = /*#__PURE__*/ Object.assign(AiOnly, {
  Avatar: AiOnlyAvatar,
  colorPrimary: '#00E5E5'
})

export default AiOnlyIcon
