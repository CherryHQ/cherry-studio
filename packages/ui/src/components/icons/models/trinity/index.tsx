import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TrinityAvatar } from './avatar'
import { TrinityDark } from './dark'
import { TrinityLight } from './light'

const Trinity = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TrinityLight {...props} className={cn('text-foreground', className)} />
  if (variant === 'dark') return <TrinityDark {...props} className={cn('text-foreground', className)} />
  return (
    <>
      <TrinityLight className={cn('text-foreground dark:hidden', className)} {...props} />
      <TrinityDark className={cn('text-foreground hidden dark:block', className)} {...props} />
    </>
  )
}

export const TrinityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Trinity, {
  Avatar: TrinityAvatar,
  colorPrimary: '#000000'
})

export default TrinityIcon
