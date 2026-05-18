import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TrinityAvatar } from './avatar'
import { TrinityDark } from './dark'
import { TrinityLight } from './light'

const Trinity = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TrinityLight {...props} className={className} />
  if (variant === 'dark') return <TrinityDark {...props} className={className} />
  return (
    <>
      <TrinityLight className={cn('dark:hidden', className)} {...props} />
      <TrinityDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const TrinityIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Trinity, {
  Avatar: TrinityAvatar,
  colorPrimary: '#000000'
})

export default TrinityIcon
