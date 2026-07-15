import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { NousresearchAvatar } from './avatar'
import { NousresearchLight } from './light'

const Nousresearch = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <NousresearchLight {...props} className={cn('text-foreground', className)} />
  return <NousresearchLight {...props} className={cn('text-foreground', className)} />
}

export const NousresearchIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Nousresearch, {
  Avatar: NousresearchAvatar,
  colorPrimary: '#000000'
})

export default NousresearchIcon
