import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { DolphinAvatar } from './avatar'
import { DolphinLight } from './light'

const Dolphin = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <DolphinLight {...props} className={cn('text-foreground', className)} />
  return <DolphinLight {...props} className={cn('text-foreground', className)} />
}

export const DolphinIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Dolphin, {
  Avatar: DolphinAvatar,
  colorPrimary: '#000000'
})

export default DolphinIcon
