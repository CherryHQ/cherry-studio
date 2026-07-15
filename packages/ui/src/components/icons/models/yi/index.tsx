import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { YiAvatar } from './avatar'
import { YiLight } from './light'

const Yi = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <YiLight {...props} className={cn('text-foreground', className)} />
  return <YiLight {...props} className={cn('text-foreground', className)} />
}

export const YiIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Yi, {
  Avatar: YiAvatar,
  colorPrimary: '#00FF25'
})

export default YiIcon
