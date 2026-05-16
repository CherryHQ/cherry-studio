import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { IdeogramAvatar } from './avatar'
import { IdeogramLight } from './light'

const Ideogram = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <IdeogramLight {...props} className={cn('text-foreground', className)} />
  return <IdeogramLight {...props} className={cn('text-foreground', className)} />
}

export const IdeogramIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Ideogram, {
  Avatar: IdeogramAvatar,
  colorPrimary: '#000000'
})

export default IdeogramIcon
