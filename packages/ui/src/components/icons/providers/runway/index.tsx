import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { RunwayAvatar } from './avatar'
import { RunwayLight } from './light'

const Runway = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <RunwayLight {...props} className={cn('text-foreground', className)} />
  return <RunwayLight {...props} className={cn('text-foreground', className)} />
}

export const RunwayIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Runway, {
  Avatar: RunwayAvatar,
  colorPrimary: '#000000'
})

export default RunwayIcon
