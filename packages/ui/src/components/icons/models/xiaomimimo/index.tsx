import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { XiaomimimoAvatar } from './avatar'
import { XiaomimimoLight } from './light'

const Xiaomimimo = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <XiaomimimoLight {...props} className={cn('text-foreground', className)} />
  return <XiaomimimoLight {...props} className={cn('text-foreground', className)} />
}

export const XiaomimimoIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Xiaomimimo, {
  Avatar: XiaomimimoAvatar,
  colorPrimary: '#000000'
})

export default XiaomimimoIcon
