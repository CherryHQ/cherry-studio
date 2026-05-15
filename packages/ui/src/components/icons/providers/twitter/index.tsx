import { cn } from '../../../../lib/utils'
import type { CompoundIcon, CompoundIconProps } from '../../types'
import { TwitterAvatar } from './avatar'
import { TwitterLight } from './light'

const Twitter = ({ variant, className, ...props }: CompoundIconProps) => {
  if (variant === 'light') return <TwitterLight {...props} className={cn('text-foreground', className)} />
  return <TwitterLight {...props} className={cn('text-foreground', className)} />
}

export const TwitterIcon: CompoundIcon = /*#__PURE__*/ Object.assign(Twitter, {
  Avatar: TwitterAvatar,
  colorPrimary: '#000000'
})

export default TwitterIcon
