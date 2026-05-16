import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { FlowithAvatar } from './avatar'
import { FlowithLight } from './light'

const Flowith = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <FlowithLight {...props} className={cn('text-foreground', className)} />
  return <FlowithLight {...props} className={cn('text-foreground', className)} />
}

export const FlowithIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Flowith, {
  Avatar: FlowithAvatar,
  colorPrimary: '#000000'
})

export default FlowithIcon
