import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { MinimaxAvatar } from './avatar'
import { MinimaxLight } from './light'

const Minimax = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <MinimaxLight {...props} className={cn('text-foreground', className)} />
  return <MinimaxLight {...props} className={cn('text-foreground', className)} />
}

export const MinimaxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Minimax, {
  Avatar: MinimaxAvatar,
  colorPrimary: '#000000'
})

export default MinimaxIcon
