import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { GrokAvatar } from './avatar'
import { GrokLight } from './light'

const Grok = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <GrokLight {...props} className={cn('text-foreground', className)} />
  return <GrokLight {...props} className={cn('text-foreground', className)} />
}

export const GrokIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Grok, {
  Avatar: GrokAvatar,
  colorPrimary: '#000000'
})

export default GrokIcon
