import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { VercelAvatar } from './avatar'
import { VercelLight } from './light'

const Vercel = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <VercelLight {...props} className={cn('text-foreground', className)} />
  return <VercelLight {...props} className={cn('text-foreground', className)} />
}

export const VercelIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Vercel, {
  Avatar: VercelAvatar,
  colorPrimary: '#000000'
})

export default VercelIcon
