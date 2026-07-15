import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BaaiAvatar } from './avatar'
import { BaaiLight } from './light'

const Baai = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BaaiLight {...props} className={cn('text-foreground', className)} />
  return <BaaiLight {...props} className={cn('text-foreground', className)} />
}

export const BaaiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Baai, {
  Avatar: BaaiAvatar,
  colorPrimary: '#000000'
})

export default BaaiIcon
