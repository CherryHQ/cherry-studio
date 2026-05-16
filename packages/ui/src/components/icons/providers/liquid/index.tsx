import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LiquidAvatar } from './avatar'
import { LiquidLight } from './light'

const Liquid = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LiquidLight {...props} className={cn('text-foreground', className)} />
  return <LiquidLight {...props} className={cn('text-foreground', className)} />
}

export const LiquidIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Liquid, {
  Avatar: LiquidAvatar,
  colorPrimary: '#000000'
})

export default LiquidIcon
