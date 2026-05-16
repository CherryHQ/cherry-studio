import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BflAvatar } from './avatar'
import { BflLight } from './light'

const Bfl = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BflLight {...props} className={cn('text-foreground', className)} />
  return <BflLight {...props} className={cn('text-foreground', className)} />
}

export const BflIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bfl, {
  Avatar: BflAvatar,
  colorPrimary: '#000000'
})

export default BflIcon
