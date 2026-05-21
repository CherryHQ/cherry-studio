import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GlamaAvatar } from './avatar'
import { GlamaLight } from './light'

const Glama = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GlamaLight {...props} className={cn('text-foreground', className)} />
  return <GlamaLight {...props} className={cn('text-foreground', className)} />
}

export const GlamaIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Glama, {
  Avatar: GlamaAvatar,
  colorPrimary: '#000000'
})

export default GlamaIcon
