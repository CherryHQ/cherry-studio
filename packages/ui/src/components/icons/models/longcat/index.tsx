import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { LongcatAvatar } from './avatar'
import { LongcatLight } from './light'

const Longcat = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <LongcatLight {...props} className={cn('text-foreground', className)} />
  return <LongcatLight {...props} className={cn('text-foreground', className)} />
}

export const LongcatIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Longcat, {
  Avatar: LongcatAvatar,
  colorPrimary: '#29E154'
})

export default LongcatIcon
