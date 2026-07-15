import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { AceAvatar } from './avatar'
import { AceLight } from './light'

const Ace = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <AceLight {...props} className={cn('text-foreground', className)} />
  return <AceLight {...props} className={cn('text-foreground', className)} />
}

export const AceIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ace, {
  Avatar: AceAvatar,
  colorPrimary: '#000000'
})

export default AceIcon
