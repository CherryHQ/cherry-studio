import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { ComposioAvatar } from './avatar'
import { ComposioLight } from './light'

const Composio = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <ComposioLight {...props} className={cn('text-foreground', className)} />
  return <ComposioLight {...props} className={cn('text-foreground', className)} />
}

export const ComposioIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Composio, {
  Avatar: ComposioAvatar,
  colorPrimary: '#000000'
})

export default ComposioIcon
