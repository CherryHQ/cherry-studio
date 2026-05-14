import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MoonshotAvatar } from './avatar'
import { MoonshotDark } from './dark'
import { MoonshotLight } from './light'

const Moonshot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MoonshotLight {...props} className={className} />
  if (variant === 'dark') return <MoonshotDark {...props} className={className} />
  return (
    <>
      <MoonshotLight className={cn('dark:hidden', className)} {...props} />
      <MoonshotDark className={cn('hidden dark:block', className)} {...props} />
    </>
  )
}

export const MoonshotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Moonshot, {
  Avatar: MoonshotAvatar,
  colorPrimary: '#000000'
})

export default MoonshotIcon
