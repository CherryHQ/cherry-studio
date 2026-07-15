import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { BilibiliindexAvatar } from './avatar'
import { BilibiliindexLight } from './light'

const Bilibiliindex = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <BilibiliindexLight {...props} className={cn('text-foreground', className)} />
  return <BilibiliindexLight {...props} className={cn('text-foreground', className)} />
}

export const BilibiliindexIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Bilibiliindex, {
  Avatar: BilibiliindexAvatar,
  colorPrimary: '#000000'
})

export default BilibiliindexIcon
