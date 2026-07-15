import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FluxAvatar } from './avatar'
import { FluxLight } from './light'

const Flux = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FluxLight {...props} className={cn('text-foreground', className)} />
  return <FluxLight {...props} className={cn('text-foreground', className)} />
}

export const FluxIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Flux, {
  Avatar: FluxAvatar,
  colorPrimary: '#000000'
})

export default FluxIcon
