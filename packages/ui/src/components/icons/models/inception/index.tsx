import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { InceptionAvatar } from './avatar'
import { InceptionLight } from './light'

const Inception = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <InceptionLight {...props} className={cn('text-foreground', className)} />
  return <InceptionLight {...props} className={cn('text-foreground', className)} />
}

export const InceptionIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Inception, {
  Avatar: InceptionAvatar,
  colorPrimary: '#000000'
})

export default InceptionIcon
