import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { PhindAvatar } from './avatar'
import { PhindLight } from './light'

const Phind = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <PhindLight {...props} className={cn('text-foreground', className)} />
  return <PhindLight {...props} className={cn('text-foreground', className)} />
}

export const PhindIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Phind, {
  Avatar: PhindAvatar,
  colorPrimary: '#000000'
})

export default PhindIcon
