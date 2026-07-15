import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MoonshotAvatar } from './avatar'
import { MoonshotLight } from './light'

const Moonshot = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MoonshotLight {...props} className={cn('text-foreground', className)} />
  return <MoonshotLight {...props} className={cn('text-foreground', className)} />
}

export const MoonshotIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Moonshot, {
  Avatar: MoonshotAvatar,
  colorPrimary: '#000000'
})

export default MoonshotIcon
