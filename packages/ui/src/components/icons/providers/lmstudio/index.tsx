import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LmstudioAvatar } from './avatar'
import { LmstudioDark } from './dark'
import { LmstudioLight } from './light'

const Lmstudio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LmstudioLight {...props} className={className} />
  if (variant === 'dark') return <LmstudioDark {...props} className={className} />
  return (
    <>
      <LmstudioLight className={cn('dark:hidden', className)} {...props} />
      <LmstudioDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const LmstudioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Lmstudio, {
  Avatar: LmstudioAvatar,
  colorPrimary: '#000000'
})

export default LmstudioIcon
